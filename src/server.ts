// src/server.ts
// Backend using Node.js with TypeScript, 'ws' for WebSockets and '@google-cloud/speech'

// --- Imports ---
import WebSocket, { WebSocketServer } from 'ws'; // Import WebSocket and server
import { SpeechClient, protos } from '@google-cloud/speech'; // Import client and proto types
import * as path from 'path'; // To handle file paths
import * as fs from 'fs'; // To check file existence (Filesystem)

// --- Configuration ---
// Use environment variable for port, fallback to 8081
const PORT: number = parseInt(process.env.PORT || '8081', 10);
const EXPECTED_SAMPLE_RATE = 48000; // Define expected sample rate (max for Google Streaming)
console.log(`[Config] WebSocket server configured for port: ${PORT}`);
console.log(`[Config] Expected audio sample rate: ${EXPECTED_SAMPLE_RATE} Hz`);

// --- Google Cloud Credentials Configuration ---
// Prioritize environment variable, fallback to local file.
let GOOGLE_APPLICATION_CREDENTIALS_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!GOOGLE_APPLICATION_CREDENTIALS_PATH) {
    console.log("[Credentials] Environment variable GOOGLE_APPLICATION_CREDENTIALS not set.");
    // Build path to the file in the project root
    const fallbackCredentialsPath = path.resolve(__dirname, '..', 'generative-456015-2182f613d6f3.json'); // Adjust filename if needed

    // Check if fallback file exists before using it
    if (fs.existsSync(fallbackCredentialsPath)) {
        console.log(`[Credentials] Using local credentials file found at: ${fallbackCredentialsPath}`);
        process.env.GOOGLE_APPLICATION_CREDENTIALS = fallbackCredentialsPath;
        GOOGLE_APPLICATION_CREDENTIALS_PATH = fallbackCredentialsPath; // Update local variable too
    } else {
        console.error(`[Credentials] Critical Error: Fallback credentials file not found at ${fallbackCredentialsPath}`);
        console.error('[Credentials] Set the GOOGLE_APPLICATION_CREDENTIALS environment variable or place the .json file in the project root.');
        process.exit(1); // Exit if no credentials found
    }
} else {
     console.log(`[Credentials] Using credentials from environment variable: ${GOOGLE_APPLICATION_CREDENTIALS_PATH}`);
}

// --- Initialization ---
// Create WebSocket server instance
const wss = new WebSocketServer({ port: PORT });
// Create Google Speech-to-Text client instance
let speechClient: SpeechClient;
try {
    console.log('[Init] Initializing Google Speech Client...');
    speechClient = new SpeechClient();
    console.log('[Init] Google Speech Client initialized successfully!');
} catch (error) {
    console.error("[Init] Error initializing Google Speech Client:", error);
    console.error("[Init] Verify the credentials path is correct and the file is valid.");
    process.exit(1);
}

console.log(`[Server] WebSocket server started on port ${PORT}`);
console.log('[Server] WebSocket connection handler configured and awaiting connections.');

// --- WebSocket Logic ---
wss.on('connection', (ws: WebSocket, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log(`[WebSocket] Client connected from IP: ${clientIp}.`);
    // Reference to the Google API recognition stream
    let recognizeStream: any = null; // Consider using a more specific type if available

    // Function to start the recognition stream to Google API
    const startGoogleStream = () => {
        console.log('[Google API] Attempting to start stream to Google Speech API...');

        // *** Use the defined EXPECTED_SAMPLE_RATE ***
        console.log(`[Google API] Configuring with Sample Rate: ${EXPECTED_SAMPLE_RATE} Hz`);

        // Configuration for the streaming request (v1 API)
        const requestConfig: protos.google.cloud.speech.v1.IStreamingRecognitionConfig = {
            config: {
                encoding: 'LINEAR16', // Make sure frontend sends this format
                sampleRateHertz: EXPECTED_SAMPLE_RATE, // Must match the actual rate from frontend
                languageCode: 'pt-BR',
                enableAutomaticPunctuation: true,
                model: 'latest_long', // Consider 'telephony' or other models if needed
                useEnhanced: true,
            },
            interimResults: true,
        };

        console.log('[Google API] Request Config:', JSON.stringify(requestConfig, null, 2));

        try {
            // Create the bidirectional gRPC stream
            recognizeStream = speechClient.streamingRecognize(requestConfig)
                .on('error', (err: Error) => {
                    // Log the full error object for more details
                    console.error('[Google API] Stream Error:', JSON.stringify(err, Object.getOwnPropertyNames(err)));
                    const errorMessage = `Google API Error: ${err.message || 'Unknown error'}`;
                    if (ws.readyState === WebSocket.OPEN) {
                        console.log(`[WebSocket] Sending error to client: ${errorMessage}`);
                        ws.send(JSON.stringify({ error: errorMessage }));
                    } else {
                        console.warn('[WebSocket] Cannot send error to client, WebSocket state:', ws.readyState);
                    }
                    // Attempt to destroy the stream gracefully on error
                    if (recognizeStream && typeof recognizeStream.destroy === 'function') {
                        console.log('[Google API] Attempting to destroy stream due to error...');
                        recognizeStream.destroy(err);
                    } else {
                         console.warn('[Google API] Cannot destroy stream (may already be destroyed or method unavailable).');
                    }
                    recognizeStream = null; // Nullify the reference
                })
                .on('data', (data) => {
                    // Log the raw data received from Google for debugging
                    console.log('[Google API] <<< Raw Data Received:', JSON.stringify(data, null, 2));

                    // Process results
                    if (data.results && data.results.length > 0) {
                        const result = data.results[0];
                        if (result.alternatives && result.alternatives.length > 0) {
                            const transcript = result.alternatives[0].transcript;
                            const isFinal = result.is_final || false; // Ensure boolean

                            if (transcript) {
                                console.log(`[Google API] Transcript (isFinal=${isFinal}): "${transcript}"`);
                                if (ws.readyState === WebSocket.OPEN) {
                                    const messageToSend = JSON.stringify({ transcript: transcript, isFinal: isFinal });
                                    console.log(`[WebSocket] Sending transcript to client: ${messageToSend}`);
                                    ws.send(messageToSend);
                                } else {
                                    console.warn('[WebSocket] Cannot send transcript to client, WebSocket state:', ws.readyState);
                                }
                            } else {
                                console.log("[Google API] Received result alternative, but transcript is empty.");
                            }
                        } else {
                            console.log("[Google API] Received result, but no alternatives found.");
                        }
                    } else if (data.speechEventType) {
                         console.log(`[Google API] Received Speech Event: ${data.speechEventType}`);
                    }
                     else {
                         console.log("[Google API] Received data from Google API, but no results/event found in expected format.");
                    }
                })
                .on('end', () => {
                    // This event indicates the read side of the stream has ended (Google stopped sending data)
                    console.log('[Google API] Stream (read side) ended.');
                })
                .on('close', () => {
                    // This event indicates the stream is fully closed (both read and write)
                    console.log('[Google API] Stream closed.');
                    recognizeStream = null; // Nullify the reference
                });

            console.log('[Google API] Stream to Google Speech API initiated successfully.');

        } catch (error) {
            console.error("[Google API] Critical failure creating stream to Google API:", error);
            if (ws.readyState === WebSocket.OPEN) {
                const errorMsg = 'Internal failure starting transcription service.';
                console.log(`[WebSocket] Sending critical error to client: ${errorMsg}`);
                ws.send(JSON.stringify({ error: errorMsg }));
            }
            recognizeStream = null;
        }
    };

    // --- WebSocket Client Message Handling ---
    ws.on('message', (message: Buffer | string) => {
        if (typeof message === 'string') {
            // Handle command messages
            console.log(`[WebSocket] Received string message (potential command): ${message}`);
            try {
                const command = JSON.parse(message);
                console.log("[WebSocket] Parsed command:", command);
                if (command.command === 'stopStreaming') {
                    console.log("[WebSocket] Received 'stopStreaming' command from client.");
                    if (recognizeStream && !recognizeStream.destroyed && recognizeStream.writable) {
                        console.log("[Google API] Ending write stream to Google API due to client command...");
                        recognizeStream.end(); // Signal Google we won't send more audio
                        // recognizeStream will emit 'close' eventually
                    } else {
                        console.log("[Google API] Cannot end stream: Stream not available, already destroyed, or not writable.");
                    }
                } else {
                    console.warn("[WebSocket] Received unknown JSON command:", command);
                }
            } catch (e) {
                console.warn("[WebSocket] Received string message that is not valid JSON:", message, "Error:", e);
            }
        } else if (message instanceof Buffer) {
            // Handle audio data
            console.log(`[WebSocket] Received audio buffer. Size: ${message.length} bytes.`);

            // Check if the stream needs to be started
            if (!recognizeStream || recognizeStream.destroyed) {
                 if (!recognizeStream) {
                     console.log("[WebSocket] First audio chunk received, starting Google stream.");
                     startGoogleStream();
                     // Wait a short moment for the stream to potentially establish before sending the first chunk
                     // NOTE: This is a potential race condition. Ideally, wait for an 'open' or similar event if the stream provided one.
                     setTimeout(() => {
                         if (recognizeStream && !recognizeStream.destroyed && recognizeStream.writable) {
                             console.log("[WebSocket] Sending first audio chunk after short delay.");
                             processAndSendAudio(message);
                         } else {
                             console.warn("[WebSocket] Stream not ready after timeout, discarding first chunk.");
                         }
                     }, 150); // Increased delay slightly
                 } else { // Stream exists but is destroyed
                     console.warn("[WebSocket] Received audio buffer, but Google stream is destroyed. Discarding.");
                 }
                 return; // Don't process this chunk yet if stream was just started or is destroyed
            }

            // Process and send audio if stream is ready
             if (recognizeStream && !recognizeStream.destroyed && recognizeStream.writable) {
                processAndSendAudio(message);
             } else {
                 console.warn(`[WebSocket] Received audio buffer, but Google stream is not ready (Destroyed: ${recognizeStream?.destroyed}, Writable: ${recognizeStream?.writable}). Discarding.`);
             }

        } else {
            console.warn("[WebSocket] Received message of unexpected type:", typeof message);
        }
    });

    // Helper function to process and send audio buffer
    const processAndSendAudio = (audioBuffer: Buffer) => {
        // --- LOGGING: Input Buffer Details ---
        console.log(`[Audio Processing] Processing buffer. Input size: ${audioBuffer.length} bytes.`);

        // --- VALIDATION: Check if buffer size is multiple of 4 (for Float32) ---
        // This assumes the frontend is sending Float32Array buffers. Adjust if it sends Int16 directly.
        if (audioBuffer.length % 4 !== 0) {
            console.warn(`[Audio Processing] Received buffer with length ${audioBuffer.length}, which is not divisible by 4 (expected Float32). Discarding chunk.`);
            // Potentially send an error back to the client or try to handle partial data if possible.
            return;
        }

        let float32Array: Float32Array;
        try {
            // Create an ArrayBuffer that shares the same memory as the Node.js Buffer
            // IMPORTANT: Ensure the underlying memory is correctly aligned if issues arise.
            const alignedBuffer = audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength);
            float32Array = new Float32Array(alignedBuffer);
            // --- LOGGING: Float32 Array Details ---
            console.log(`[Audio Processing] Converted to Float32Array. Length: ${float32Array.length}. First few values: [${float32Array.slice(0, 5).join(', ')}]`);

        } catch (conversionError) {
            console.error("[Audio Processing] Error converting Buffer to Float32Array:", conversionError);
            console.error("[Audio Processing] Buffer details:", { length: audioBuffer.length, contentStart: audioBuffer.slice(0, 16) });
            return; // Stop processing this chunk
        }

        // --- Conversion: Float32 to Int16 (LINEAR16 encoding expected by Google API) ---
        const int16Array = new Int16Array(float32Array.length);
        for (let i = 0; i < float32Array.length; i++) {
            // Clamp values to the Int16 range [-32768, 32767]
            // Multiply by 32767 (max positive Int16 value) to scale the [-1.0, 1.0] float range
            int16Array[i] = Math.max(-32768, Math.min(32767, float32Array[i] * 32767));
        }
        // --- LOGGING: Int16 Array Details ---
        console.log(`[Audio Processing] Converted to Int16Array. Length: ${int16Array.length}. First few values: [${int16Array.slice(0, 5).join(', ')}]`);


        // --- Sending to Google ---
        if (recognizeStream && !recognizeStream.destroyed && recognizeStream.writable) {
            try {
                // Google API expects raw audio bytes. Send the Int16Array's underlying buffer.
                // IMPORTANT: Ensure the Int16Array buffer is what needs to be sent.
                // Sometimes, you might need `Buffer.from(int16Array.buffer)` depending on the API client library.
                // The `@google-cloud/speech` library's `streamingRecognize` stream usually handles Buffers or Uint8Arrays containing the raw audio data.
                // Let's assume sending the Int16Array directly works as it might be handled internally,
                // but if not, convert: `Buffer.from(int16Array.buffer)`
                 const dataToSend = Buffer.from(int16Array.buffer); // More explicit conversion to Buffer
                 console.log(`[Google API] >>> Writing audio chunk. Size: ${dataToSend.length} bytes.`);
                 recognizeStream.write(dataToSend);
                 // console.log(`[Google API] >>> Writing audio chunk. Size: ${int16Array.byteLength} bytes.`);
                 // recognizeStream.write(int16Array); // Previous attempt
            } catch (writeError) {
                console.error("[Google API] Error writing audio chunk to Google Stream:", writeError);
                // Consider closing the stream or notifying the client
            }
        } else {
             // This case should ideally be caught before calling processAndSendAudio, but log just in case.
             console.warn("[Audio Processing] Cannot send audio: Google stream is not writable or available.");
        }
    };


    // --- WebSocket Connection Close and Error Handling ---
    ws.on('close', (code: number, reason: Buffer) => {
        const reasonString = reason.toString() || 'No reason specified';
        console.log(`[WebSocket] Client disconnected. Code: ${code}, Reason: ${reasonString}, IP: ${clientIp}`);
        // Ensure Google stream is properly ended when client disconnects
        if (recognizeStream && !recognizeStream.destroyed) {
            console.log('[Google API] Client disconnected, ending write stream to Google API.');
            if (recognizeStream.writable) {
                 try {
                    recognizeStream.end(); // Signal Google we won't send more audio
                 } catch (endError) {
                     console.error('[Google API] Error trying to end stream on client disconnect:', endError);
                 }
            } else {
                 console.log('[Google API] Stream was not writable when client disconnected, likely already ending/closed.');
            }
             // Destroy might be necessary if 'end' doesn't close it quickly enough or if there was an error
             // setTimeout(() => {
             //     if (recognizeStream && !recognizeStream.destroyed) {
             //         console.log('[Google API] Destroying stream after client disconnect timeout...');
             //         recognizeStream.destroy();
             //     }
             // }, 500); // Delay destroy slightly
        } else {
             console.log('[Google API] No active or non-destroyed stream found upon client disconnect.');
        }
        recognizeStream = null; // Clear reference
    });

    ws.on('error', (error: Error) => {
        console.error(`[WebSocket] Client connection error: ${error.message}`, error);
        // Attempt to clean up the Google stream on WebSocket error
        if (recognizeStream && !recognizeStream.destroyed) {
            console.log('[Google API] Client WebSocket error, attempting to destroy Google API stream.');
             try {
                recognizeStream.destroy(error);
             } catch (destroyError) {
                 console.error('[Google API] Error trying to destroy stream on client WebSocket error:', destroyError);
             }
        }
        recognizeStream = null; // Clear reference
    });
});

// --- WebSocket Server Error Handling ---
wss.on('error', (error: Error) => {
    console.error('[Server] Fatal WebSocket Server Error:', error);
    // Consider attempting a graceful shutdown or restart procedure here
});
