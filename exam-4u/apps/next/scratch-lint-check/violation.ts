// Temporary file to prove the new module-boundary ESLint rules actually fire — deleted immediately
// after verification, per this project's established exit-gate convention.
import { PdfProcessingService } from '../src/server/pdf-processing/application/pdf-processing.service';
import { extractPdfPages } from '../src/server/infrastructure/text-extraction/pdf-text-extractor';

export { PdfProcessingService, extractPdfPages };
