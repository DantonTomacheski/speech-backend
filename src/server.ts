
import WebSocket, { WebSocketServer } from 'ws';
import { SpeechClient, protos } from '@google-cloud/speech';
import * as path from 'path';
import * as fs from 'fs';


const PORT: number = parseInt(process.env.PORT || '8081', 10);
const EXPECTED_SAMPLE_RATE = 48000;
console.log(`[Config] WebSocket server configured for port: ${PORT}`);
console.log(`[Config] Expected audio sample rate: ${EXPECTED_SAMPLE_RATE} Hz`);
let GOOGLE_APPLICATION_CREDENTIALS_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!GOOGLE_APPLICATION_CREDENTIALS_PATH) {
    console.log("[Credentials] Environment variable GOOGLE_APPLICATION_CREDENTIALS not set.");
    const fallbackCredentialsPath = path.resolve(__dirname, '..', 'generative-456015-2182f613d6f3.json');


    if (fs.existsSync(fallbackCredentialsPath)) {
        console.log(`[Credentials] Using local credentials file found at: ${fallbackCredentialsPath}`);
        process.env.GOOGLE_APPLICATION_CREDENTIALS = fallbackCredentialsPath;
        GOOGLE_APPLICATION_CREDENTIALS_PATH = fallbackCredentialsPath;
    } else {
        console.error(`[Credentials] Critical Error: Fallback credentials file not found at ${fallbackCredentialsPath}`);
        console.error('[Credentials] Set the GOOGLE_APPLICATION_CREDENTIALS environment variable or place the .json file in the project root.');
        process.exit(1);
    }
} else {
     console.log(`[Credentials] Using credentials from environment variable: ${GOOGLE_APPLICATION_CREDENTIALS_PATH}`);
}


const wss = new WebSocketServer({ port: PORT });

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


wss.on('connection', (ws: WebSocket, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log(`[WebSocket] Client connected from IP: ${clientIp}.`);
    let recognizeStream: any = null;


    const startGoogleStream = () => {
        console.log('[Google API] Attempting to start stream to Google Speech API...');


        console.log(`[Google API] Configuring with Sample Rate: ${EXPECTED_SAMPLE_RATE} Hz`);


        const requestConfig: protos.google.cloud.speech.v1.IStreamingRecognitionConfig = {
            config: {
                encoding: 'LINEAR16',
                sampleRateHertz: EXPECTED_SAMPLE_RATE,
                languageCode: 'pt-BR',
                enableAutomaticPunctuation: true,
                model: 'latest_long',
                useEnhanced: true,
            },
            interimResults: true,
        };

        console.log('[Google API] Request Config:', JSON.stringify(requestConfig, null, 2));

        try {
            recognizeStream = speechClient.streamingRecognize(requestConfig)
                .on('error', (err: Error) => {
                    console.error('[Google API] Stream Error:', JSON.stringify(err, Object.getOwnPropertyNames(err)));
                    const errorMessage = `Google API Error: ${err.message || 'Unknown error'}`;
                    if (ws.readyState === WebSocket.OPEN) {
                        console.log(`[WebSocket] Sending error to client: ${errorMessage}`);
                        ws.send(JSON.stringify({ error: errorMessage }));
                    } else {
                        console.warn('[WebSocket] Cannot send error to client, WebSocket state:', ws.readyState);
                    }
                    if (recognizeStream && typeof recognizeStream.destroy === 'function') {
                        console.log('[Google API] Attempting to destroy stream due to error...');
                        recognizeStream.destroy(err);
                    } else {
                         console.warn('[Google API] Cannot destroy stream (may already be destroyed or method unavailable).');
                    }
                    recognizeStream = null;
                })
                .on('data', (data) => {
                    console.log('[Google API] <<< Raw Data Received:', JSON.stringify(data, null, 2));

                    if (data.results && data.results.length > 0) {
                        const result = data.results[0];
                        if (result.alternatives && result.alternatives.length > 0) {
                            const transcript = result.alternatives[0].transcript;
                            const isFinal = result.is_final || false;

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
                    console.log('[Google API] Stream (read side) ended.');
                })
                .on('close', () => {
                    console.log('[Google API] Stream closed.');
                    recognizeStream = null;
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


    ws.on('message', (message: Buffer | string) => {
        if (typeof message === 'string') {

            console.log(`[WebSocket] Received string message (potential command): ${message}`);
            try {
                const command = JSON.parse(message);
                console.log("[WebSocket] Parsed command:", command);
                if (command.command === 'stopStreaming') {
                    console.log("[WebSocket] Received 'stopStreaming' command from client.");
                    if (recognizeStream && !recognizeStream.destroyed && recognizeStream.writable) {
                        console.log("[Google API] Ending write stream to Google API due to client command...");
                        recognizeStream.end();
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

            console.log(`[WebSocket] Received audio buffer. Size: ${message.length} bytes.`);


            if (!recognizeStream || recognizeStream.destroyed) {
                 if (!recognizeStream) {
                     console.log("[WebSocket] First audio chunk received, starting Google stream.");
                     startGoogleStream();
                     setTimeout(() => {
                         if (recognizeStream && !recognizeStream.destroyed && recognizeStream.writable) {
                             console.log("[WebSocket] Sending first audio chunk after short delay.");
                             processAndSendAudio(message);
                         } else {
                             console.warn("[WebSocket] Stream not ready after timeout, discarding first chunk.");
                         }
                     }, 150);
                 } else {
                     console.warn("[WebSocket] Received audio buffer, but Google stream is destroyed. Discarding.");
                 }
                 return;
            }


             if (recognizeStream && !recognizeStream.destroyed && recognizeStream.writable) {
                processAndSendAudio(message);
             } else {
                 console.warn(`[WebSocket] Received audio buffer, but Google stream is not ready (Destroyed: ${recognizeStream?.destroyed}, Writable: ${recognizeStream?.writable}). Discarding.`);
             }

        } else {
            console.warn("[WebSocket] Received message of unexpected type:", typeof message);
        }
    });

    
    const processAndSendAudio = (audioBuffer: Buffer) => {
        console.log(`[Audio Processing] Processing buffer. Input size: ${audioBuffer.length} bytes.`);
        if (audioBuffer.length % 4 !== 0) {
            console.warn(`[Audio Processing] Received buffer with length ${audioBuffer.length}, which is not divisible by 4 (expected Float32). Discarding chunk.`);
            return;
        }

        let float32Array: Float32Array;
        try {
            const alignedBuffer = audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength);
            float32Array = new Float32Array(alignedBuffer);
            console.log(`[Audio Processing] Converted to Float32Array. Length: ${float32Array.length}. First few values: [${float32Array.slice(0, 5).join(', ')}]`);

        } catch (conversionError) {
            console.error("[Audio Processing] Error converting Buffer to Float32Array:", conversionError);
            console.error("[Audio Processing] Buffer details:", { length: audioBuffer.length, contentStart: audioBuffer.slice(0, 16) });
            return;
        }

        const int16Array = new Int16Array(float32Array.length);
        for (let i = 0; i < float32Array.length; i++) {
            int16Array[i] = Math.max(-32768, Math.min(32767, float32Array[i] * 32767));
        }
        console.log(`[Audio Processing] Converted to Int16Array. Length: ${int16Array.length}. First few values: [${int16Array.slice(0, 5).join(', ')}]`);


        if (recognizeStream && !recognizeStream.destroyed && recognizeStream.writable) {
            try {
                 const dataToSend = Buffer.from(int16Array.buffer);
                 console.log(`[Google API] >>> Writing audio chunk. Size: ${dataToSend.length} bytes.`);
                 recognizeStream.write(dataToSend);

            } catch (writeError) {
                console.error("[Google API] Error writing audio chunk to Google Stream:", writeError);

            }
        } else {

             console.warn("[Audio Processing] Cannot send audio: Google stream is not writable or available.");
        }
    };



    ws.on('close', (code: number, reason: Buffer) => {
        const reasonString = reason.toString() || 'No reason specified';
        console.log(`[WebSocket] Client disconnected. Code: ${code}, Reason: ${reasonString}, IP: ${clientIp}`);

        if (recognizeStream && !recognizeStream.destroyed) {
            console.log('[Google API] Client disconnected, ending write stream to Google API.');
            if (recognizeStream.writable) {
                 try {
                    recognizeStream.end();
                 } catch (endError) {
                     console.error('[Google API] Error trying to end stream on client disconnect:', endError);
                 }
            } else {
                 console.log('[Google API] Stream was not writable when client disconnected, likely already ending/closed.');
            }

        } else {
             console.log('[Google API] No active or non-destroyed stream found upon client disconnect.');
        }
        recognizeStream = null;
    });

    ws.on('error', (error: Error) => {
        console.error(`[WebSocket] Client connection error: ${error.message}`, error);

        if (recognizeStream && !recognizeStream.destroyed) {
            console.log('[Google API] Client WebSocket error, attempting to destroy Google API stream.');
             try {
                recognizeStream.destroy(error);
             } catch (destroyError) {
                 console.error('[Google API] Error trying to destroy stream on client WebSocket error:', destroyError);
             }
        }
        recognizeStream = null;
    });
});


wss.on('error', (error: Error) => {
    console.error('[Server] Fatal WebSocket Server Error:', error);

});
