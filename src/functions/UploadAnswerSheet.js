const { app } = require("@azure/functions");
const { BlobServiceClient } = require("@azure/storage-blob");
const { DocumentAnalysisClient } = require("@azure/ai-form-recognizer");
const { AzureKeyCredential } = require("@azure/core-auth");

app.http("UploadAnswerSheet", {
    methods: ["POST"],
    authLevel: "anonymous",

    handler: async (request, context) => {
        try {
            // Blob container setup
            const containerName = process.env.BLOB_CONTAINER_NAME || "papers";
            const connectionString = process.env.AzureWebJobsStorage;
            const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
            const containerClient = blobServiceClient.getContainerClient(containerName);
            await containerClient.createIfNotExists();

            // Metadata from headers
            const studentName = request.headers.get("x-student-name");
            const rollNumber = request.headers.get("x-roll-number");
            const subject = request.headers.get("x-subject");
            const examName = request.headers.get("x-exam-name");
            const originalFileName = request.headers.get("x-file-name");

            const extension = originalFileName.substring(originalFileName.lastIndexOf("."));
            const blobName = `${rollNumber}_${studentName.replace(/\s+/g, "_")}${extension}`;

            // File buffer
            const fileBuffer = Buffer.from(await request.arrayBuffer());

            // Upload to Blob
            const blockBlobClient = containerClient.getBlockBlobClient(blobName);
            await blockBlobClient.uploadData(fileBuffer, {
                metadata: {
                    studentname: studentName,
                    rollnumber: rollNumber,
                    subject: subject,
                    examname: examName
                }
            });

            // Run Document Intelligence OCR
            const endpoint = process.env.FORM_RECOGNIZER_ENDPOINT;
            const key = process.env.FORM_RECOGNIZER_KEY;
            const client = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(key));

            const poller = await client.beginAnalyzeDocument("prebuilt-document", fileBuffer);
            const result = await poller.pollUntilDone();

            const extractedText = [];
            for (const page of result.pages) {
                for (const line of page.lines) {
                    extractedText.push(line.content);
                }
            }

            // Save OCR results into processed container
            const processedClient = blobServiceClient.getContainerClient("processed");
            await processedClient.createIfNotExists();
            const processedBlob = processedClient.getBlockBlobClient(blobName + ".json");
            await processedBlob.uploadData(Buffer.from(JSON.stringify(extractedText)), {
                overwrite: true
            });

            // Return response with preview
            return {
                status: 200,
                jsonBody: {
                    success: true,
                    fileName: blobName,
                    message: "Upload + OCR successful",
                    ocrPreview: extractedText.slice(0, 10) // first 10 lines
                }
            };
        } catch (err) {
            context.error(err);
            return {
                status: 500,
                jsonBody: {
                    success: false,
                    message: err.message
                }
            };
        }
    }
});
