"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — secure file uploads
   ----------------------------------------------------------------------------
   • images only (jpg/png/webp), max size from env
   • random file names (client name never used on disk)
   • stored under uploads/<context>/
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const config = require("../config");

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function makeStorage(context) {
  const dir = path.join(config.UPLOAD_DIR, context);
  fs.mkdirSync(dir, { recursive: true });
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
      cb(null, Date.now() + "-" + crypto.randomBytes(8).toString("hex") + ext);
    },
  });
}

const imageFilter = (req, file, cb) => {
  if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
  cb(new Error("Only JPG, PNG or WEBP images are allowed."));
};

/** multer instance for a named context dir, e.g. "logos", "photos" */
function imageUploader(context, field) {
  const up = multer({
    storage: makeStorage(context),
    limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
    fileFilter: imageFilter,
  });
  return up.single(field || "file");
}

module.exports = { imageUploader };
