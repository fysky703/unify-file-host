import crypto from "crypto";
import path from "path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const MAX_FILE_SIZE = 500 * 1024 * 1024;

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});

function cleanFileName(fileName) {
  return path.basename(String(fileName))
    .replace(/[^\w.\-() ]+/g, "_")
    .replace(/\s+/g, "-")
    .slice(0, 180);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { fileName, contentType, fileSize } = req.body || {};
    const size = Number(fileSize);

    if (!fileName) {
      return res.status(400).json({ error: "File name is required." });
    }

    if (!Number.isSafeInteger(size) || size < 1) {
      return res.status(400).json({ error: "Invalid file size." });
    }

    if (size > MAX_FILE_SIZE) {
      return res.status(413).json({ error: "Maximum file size is 500 MB." });
    }

    const safeName = cleanFileName(fileName);

    if (!safeName) {
      return res.status(400).json({ error: "Invalid file name." });
    }

    const key =
      `${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${safeName}`;

    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      ContentType: contentType || "application/octet-stream",
      ContentLength: size
    });

    const uploadUrl = await getSignedUrl(s3, command, {
      expiresIn: 600
    });

    const publicUrl =
      `${process.env.R2_PUBLIC_URL.replace(/\/+$/, "")}/${encodeURIComponent(key)}`;

    return res.status(200).json({
      success: true,
      uploadUrl,
      publicUrl,
      key
    });

  } catch (error) {
    console.error("UPLOAD URL ERROR:", error);

    return res.status(500).json({
      error: "Could not create upload URL."
    });
  }
}
