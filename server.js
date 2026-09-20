import "dotenv/config";
import express from "express";
import crypto from "crypto";
import path from "path";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const app = express();
const port = Number(process.env.PORT || 3000);
const MAX_FILE_SIZE = 500 * 1024 * 1024;

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(process.cwd(), "public")));

function cleanFileName(fileName) {
  return path.basename(String(fileName))
    .replace(/[^\w.\-() ]+/g, "_")
    .replace(/\s+/g, "-")
    .slice(0, 180);
}

// ── POST /api/upload-url ─────────────────────────
app.post("/api/upload-url", async (req, res) => {
  try {
    const { fileName, contentType, fileSize } = req.body || {};
    const size = Number(fileSize);

    if (!fileName)
      return res.status(400).json({ error: "File name is required." });

    if (!Number.isSafeInteger(size) || size < 1)
      return res.status(400).json({ error: "Invalid file size." });

    if (size > MAX_FILE_SIZE)
      return res.status(413).json({ error: "Maximum file size is 500 MB." });

    const safeName = cleanFileName(fileName);
    if (!safeName)
      return res.status(400).json({ error: "Invalid file name." });

    const key =
      `${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${safeName}`;

    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      ContentType: contentType || "application/octet-stream",
      ContentLength: size
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 600 });
    const publicUrl =
      `${process.env.R2_PUBLIC_URL.replace(/\/+$/, "")}/${encodeURIComponent(key)}`;

    res.json({ success: true, uploadUrl, publicUrl, key });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not create upload URL." });
  }
});

// ── GET /api/files ───────────────────────────────
app.get("/api/files", async (req, res) => {
  try {
    const command = new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME,
      MaxKeys: 1000
    });
    const data = await s3.send(command);
    const publicBase = process.env.R2_PUBLIC_URL.replace(/\/+$/, "");

    const files = (data.Contents || [])
      .sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified))
      .map(obj => ({
        key: obj.Key,
        name: obj.Key.replace(/^\d+-[0-9a-f]{16}-/, ""),
        size: obj.Size,
        lastModified: obj.LastModified,
        url: `${publicBase}/${encodeURIComponent(obj.Key)}`
      }));

    res.json({ success: true, files });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not list files." });
  }
});

// ── POST /api/delete-file ────────────────────────
app.post("/api/delete-file", async (req, res) => {
  try {
    const { key } = req.body || {};
    if (!key)
      return res.status(400).json({ error: "Key is required." });

    const command = new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key
    });
    await s3.send(command);

    res.json({ success: true });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not delete file." });
  }
});

// ── POST /api/delete-all ─────────────────────────
app.post("/api/delete-all", async (_req, res) => {
  try {
    let continuationToken;
    let deleted = 0;

    do {
      const listed = await s3.send(new ListObjectsV2Command({
        Bucket: process.env.R2_BUCKET_NAME,
        MaxKeys: 1000,
        ContinuationToken: continuationToken
      }));

      const objects = (listed.Contents || []).map(({ Key }) => ({ Key }));
      if (objects.length) {
        await s3.send(new DeleteObjectsCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Delete: { Objects: objects, Quiet: true }
        }));
        deleted += objects.length;
      }

      continuationToken = listed.IsTruncated
        ? listed.NextContinuationToken
        : undefined;
    } while (continuationToken);

    res.json({ success: true, deleted });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not delete all files." });
  }
});

// ── GET /api/health ──────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, storage: "Cloudflare R2", bucket: process.env.R2_BUCKET_NAME });
});

app.listen(port, () => {
  console.log(`UNiFY File Host: http://localhost:${port}`);
});
