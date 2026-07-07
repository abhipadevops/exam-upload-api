const { app } = require("@azure/functions");
const { BlobServiceClient } = require("@azure/storage-blob");

app.http("UploadAnswerSheet", {
    methods: ["POST"],
    authLevel: "anonymous",

    handler: async (request, context) => {

        try {

            const containerName =
                process.env.BLOB_CONTAINER_NAME || "answer-sheets";

            const connectionString =
                process.env.AzureWebJobsStorage;

            const blobServiceClient =
                BlobServiceClient.fromConnectionString(connectionString);

            const containerClient =
                blobServiceClient.getContainerClient(containerName);

            await containerClient.createIfNotExists();

            const studentName =
                request.headers.get("x-student-name");

            const rollNumber =
                request.headers.get("x-roll-number");

            const subject =
                request.headers.get("x-subject");

            const examName =
                request.headers.get("x-exam-name");

            const originalFileName =
                request.headers.get("x-file-name");

            const extension =
                originalFileName.substring(originalFileName.lastIndexOf("."));

            const blobName =
                `${rollNumber}_${studentName.replace(/\s+/g,"_")}${extension}`;

            const fileBuffer =
                Buffer.from(await request.arrayBuffer());

            const blockBlobClient =
                containerClient.getBlockBlobClient(blobName);

            await blockBlobClient.uploadData(fileBuffer,{
                metadata:{
                    studentname:studentName,
                    rollnumber:rollNumber,
                    subject:subject,
                    examname:examName
                }
            });

            return {
                status:200,
                jsonBody:{
                    success:true,
                    fileName:blobName,
                    message:"Answer sheet uploaded successfully."
                }
            };

        }
        catch(err){

            context.error(err);

            return{
                status:500,
                jsonBody:{
                    success:false,
                    message:err.message
                }
            }

        }

    }
});