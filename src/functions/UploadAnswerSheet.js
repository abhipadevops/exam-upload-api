const { app } = require("@azure/functions");
const { BlobServiceClient } = require("@azure/storage-blob");
const {
  DocumentAnalysisClient
} = require("@azure/ai-form-recognizer");
const { AzureKeyCredential } = require("@azure/core-auth");

app.http("UploadAnswerSheet", {
  methods: ["POST"],
  authLevel: "anonymous",

  handler: async (request, context) => {
    try {
      const connectionString = process.env.AzureWebJobsStorage;
      const containerName =
        process.env.BLOB_CONTAINER_NAME || "answer-sheets";

      const documentEndpoint =
        process.env.FORM_RECOGNIZER_ENDPOINT;

      const documentKey =
        process.env.FORM_RECOGNIZER_KEY;

      if (!connectionString) {
        throw new Error(
          "AzureWebJobsStorage environment variable is missing."
        );
      }

      if (!documentEndpoint || !documentKey) {
        throw new Error(
          "Document Intelligence endpoint or key is missing."
        );
      }

      const studentName =
        request.headers.get("x-student-name") || "";

      const rollNumber =
        request.headers.get("x-roll-number") || "";

      const subject =
        request.headers.get("x-subject") || "";

      const examName =
        request.headers.get("x-exam-name") || "";

      const originalFileName =
        request.headers.get("x-file-name") || "";

      if (!studentName || !rollNumber || !originalFileName) {
        return {
          status: 400,
          jsonBody: {
            success: false,
            message:
              "Student name, roll number and file name are required."
          }
        };
      }

      const fileBuffer = Buffer.from(
        await request.arrayBuffer()
      );

      if (fileBuffer.length === 0) {
        return {
          status: 400,
          jsonBody: {
            success: false,
            message: "Uploaded file is empty."
          }
        };
      }

      const extensionPosition =
        originalFileName.lastIndexOf(".");

      const extension =
        extensionPosition >= 0
          ? originalFileName.substring(extensionPosition)
          : "";

      const safeStudentName = studentName
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .replace(/_+/g, "_");

      const safeRollNumber = rollNumber
        .replace(/[^a-zA-Z0-9_-]/g, "_");

      const timestamp = Date.now();

      const blobName =
        `${safeRollNumber}_${safeStudentName}_${timestamp}${extension}`;

      const blobServiceClient =
        BlobServiceClient.fromConnectionString(
          connectionString
        );

      const answerSheetsContainer =
        blobServiceClient.getContainerClient(
          containerName
        );

      await answerSheetsContainer.createIfNotExists();

      const answerSheetBlob =
        answerSheetsContainer.getBlockBlobClient(
          blobName
        );

      await answerSheetBlob.uploadData(fileBuffer, {
        blobHTTPHeaders: {
          blobContentType:
            request.headers.get("content-type") ||
            "application/octet-stream"
        },
        metadata: {
          studentname: studentName,
          rollnumber: rollNumber,
          subject,
          examname: examName
        }
      });

      context.log(
        `Answer sheet uploaded: ${blobName}`
      );

      const documentClient =
        new DocumentAnalysisClient(
          documentEndpoint,
          new AzureKeyCredential(documentKey)
        );

      const poller =
        await documentClient.beginAnalyzeDocument(
          "prebuilt-read",
          fileBuffer
        );

      const result = await poller.pollUntilDone();

      const pages = [];
      const extractedLines = [];

      for (const page of result.pages || []) {
        const pageLines = [];

        for (const line of page.lines || []) {
          pageLines.push({
            content: line.content,
            polygon: line.polygon || []
          });

          extractedLines.push(line.content);
        }

        pages.push({
          pageNumber: page.pageNumber,
          width: page.width,
          height: page.height,
          unit: page.unit,
          lines: pageLines
        });
      }

      const fullText = extractedLines.join("\n");

      const ocrResult = {
        status: "ocr-completed",
        studentName,
        rollNumber,
        subject,
        examName,
        sourceFileName: originalFileName,
        storedFileName: blobName,
        processedAt: new Date().toISOString(),
        pageCount: pages.length,
        fullText,
        pages
      };

      const processedContainer =
        blobServiceClient.getContainerClient(
          "processed"
        );

      await processedContainer.createIfNotExists();

      const processedBlobName =
        `${blobName}.json`;

      const processedBlob =
        processedContainer.getBlockBlobClient(
          processedBlobName
        );

      await processedBlob.uploadData(
        Buffer.from(
          JSON.stringify(ocrResult, null, 2)
        ),
        {
          overwrite: true,
          blobHTTPHeaders: {
            blobContentType: "application/json"
          }
        }
      );

      context.log(
        `OCR result saved: ${processedBlobName}`
      );

      return {
        status: 200,
        jsonBody: {
          success: true,
          fileName: blobName,
          status: "ocr-completed",
          message:
            "Answer sheet uploaded and OCR completed successfully."
        }
      };
    } catch (error) {
      context.error(
        "UploadAnswerSheet failed:",
        error
      );

      return {
        status: 500,
        jsonBody: {
          success: false,
          message:
            error.message ||
            "Unexpected server error."
        }
      };
    }
  }
});