/**
 * Multipart handling for uploaded bills and statements.
 *
 * Memory storage on purpose: nothing touches the disk, so there is no upload
 * directory to secure, clean up, or accidentally serve back.
 */
import multer from 'multer';
import { ApiError } from '../utils/ApiError.js';
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES, isAccepted } from '../services/documentService.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (isAccepted(file.mimetype)) return cb(null, true);
    cb(ApiError.badRequest(`Unsupported file type. Accepted: ${ACCEPTED_TYPES.join(', ')}.`));
  }
});

/** Wraps multer so its own errors become the app's normal error shape. */
export const singleDocument = (req, res, next) =>
  upload.single('file')(req, res, (err) => {
    if (!err) {
      if (!req.file) return next(ApiError.badRequest('Attach a file to import.'));
      return next();
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(
        ApiError.badRequest(`That file is over ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`)
      );
    }
    next(err.expected ? err : ApiError.badRequest('That file could not be read.'));
  });
