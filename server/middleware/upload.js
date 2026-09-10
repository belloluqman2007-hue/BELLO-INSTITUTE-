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

function makeStorage(context, baseDir) {
  const dir = path.join(baseDir || config.UPLOAD_DIR, context);
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

/**
 * Generic single-file upload for trusted (super-admin) endpoints — used by the
 * backup importer. Extension + MIME are both checked, size is capped, and the
 * file name is generated (the client name is never used).
 */
function fileUploader(context, field, options = {}) {
  const allowed = options.mimeTypes || null;
  const up = multer({
    storage: makeStorage(context, options.dir),
    limits: { fileSize: (options.maxMb || 50) * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (options.extensions && !options.extensions.includes(ext)) {
        return cb(new Error("Only " + options.extensions.join(", ") + " files are allowed."));
      }
      if (allowed && !allowed.includes(file.mimetype)) {
        return cb(new Error("Unsupported file type (" + file.mimetype + ")."));
      }
      cb(null, true);
    },
  });
  return up.single(field || "file");
}

module.exports = { imageUploader, fileUploader };
