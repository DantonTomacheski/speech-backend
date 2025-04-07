// src/server.ts
// Exemplo de backend usando Node.js com TypeScript, 'ws' para WebSockets e '@google-cloud/speech'

// --- Importações ---
import WebSocket, { WebSocketServer } from 'ws'; // Importa WebSocket e o servidor
import { SpeechClient, protos } from '@google-cloud/speech'; // Importa o cliente e tipos de protos
import * as path from 'path'; // Para lidar com caminhos de arquivos
import * as fs from 'fs'; // Para verificar a existência de arquivos (Filesystem)

// --- Configuração ---
// Usa variável de ambiente para a porta, com fallback para 8081 (conforme alteração do usuário)
const PORT: number = parseInt(process.env.PORT || '8081', 10);

// --- Configuração das Credenciais do Google Cloud ---
// Prioriza a variável de ambiente, mas tem um fallback para um arquivo local.
let GOOGLE_APPLICATION_CREDENTIALS_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!GOOGLE_APPLICATION_CREDENTIALS_PATH) {
    console.log("Variável de ambiente GOOGLE_APPLICATION_CREDENTIALS não definida.");
    // Constrói o caminho para o arquivo na raiz do projeto (assumindo que 'dist' é a pasta de saída)
    // CUIDADO: Evite hardcoding de nomes de arquivos de credenciais em código compartilhado.
    const fallbackCredentialsPath = path.resolve(__dirname, '..', 'generative-456015-2182f613d6f3.json');

    // Verifica se o arquivo de fallback realmente existe antes de usá-lo
    if (fs.existsSync(fallbackCredentialsPath)) {
        console.log(`Usando arquivo de credenciais local encontrado em: ${fallbackCredentialsPath}`);
        // Define a variável de ambiente para que a biblioteca do Google a encontre
        process.env.GOOGLE_APPLICATION_CREDENTIALS = fallbackCredentialsPath;
        GOOGLE_APPLICATION_CREDENTIALS_PATH = fallbackCredentialsPath; // Atualiza a variável local também
    } else {
        console.error(`Erro Crítico: Arquivo de credenciais de fallback não encontrado em ${fallbackCredentialsPath}`);
        console.error('Defina a variável de ambiente GOOGLE_APPLICATION_CREDENTIALS ou coloque o arquivo .json na raiz do projeto.');
        process.exit(1); // Encerra se não encontrar credenciais
    }
} else {
     console.log(`Usando credenciais da variável de ambiente: ${GOOGLE_APPLICATION_CREDENTIALS_PATH}`);
}

// --- Inicialização ---
// Cria uma instância do servidor WebSocket
const wss = new WebSocketServer({ port: PORT });
// Cria uma instância do cliente Google Speech-to-Text
// A biblioteca busca automaticamente as credenciais (agora garantidas pela lógica acima)
let speechClient: SpeechClient;
try {
    speechClient = new SpeechClient();
    console.log('Cliente Google Speech inicializado com sucesso!'); // Log adicionado pelo usuário
} catch (error) {
     console.error("Erro ao inicializar o Google Speech Client:", error);
     console.error("Verifique se o caminho das credenciais está correto e se o arquivo é válido.");
     process.exit(1);
}

console.log(`Servidor WebSocket iniciado na porta ${PORT}`);

// --- Lógica do WebSocket ---
wss.on('connection', (ws: WebSocket) => {
    console.log('Cliente conectado via WebSocket.');
    // Referência para o stream de reconhecimento da API do Google
    let recognizeStream: any = null; // Mantido como 'any' para simplicidade

    // Função para iniciar o stream de reconhecimento para a API do Google
    const startGoogleStream = () => {
        console.log('Iniciando stream para Google Speech API...');

        // Configuração da requisição de streaming para a API v1
        const requestConfig: protos.google.cloud.speech.v1.IStreamingRecognitionConfig = {
            config: {
                encoding: 'LINEAR16',
                sampleRateHertz: 44100,
                languageCode: 'pt-BR',
                enableAutomaticPunctuation: true,
                model: 'command_and_search', // Modelo v1 válido: command_and_search, phone_call, video, default
                useEnhanced: true,
            },
            interimResults: true, // Essencial para baixa latência
        };

        try {
            // Cria o stream gRPC bidirecional
            recognizeStream = speechClient.streamingRecognize(requestConfig)
                .on('error', (err: Error) => {
                    console.error('Erro no stream da API do Google:', err);
                    const errorMessage = `Erro na API do Google: ${err.message || 'Erro desconhecido'}`;
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ error: errorMessage }));
                    }
                    if (recognizeStream) {
                        recognizeStream.destroy(err);
                        recognizeStream = null;
                    }
                })
                .on('data', (data) => {
                    // Processamento de resposta para v2 API
                    if (data.results && data.results.length > 0) {
                        const result = data.results[0];
                        
                        if (result.alternatives && result.alternatives.length > 0) {
                            const transcript = result.alternatives[0].transcript;
                            const isFinal = result.is_final || false;
                            
                            if (transcript) {
                                if (ws.readyState === WebSocket.OPEN) {
                                    ws.send(JSON.stringify({ transcript: transcript, isFinal: isFinal }));
                                }
                            }
                        }
                    }
                })
                .on('end', () => {
                    console.log('Stream da API do Google (leitura) finalizado.');
                });

            console.log('Stream para Google Speech API iniciado com sucesso.');

        } catch (error) {
            console.error("Falha crítica ao criar o stream para o Google API:", error);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ error: 'Falha interna ao iniciar o serviço de transcrição.' }));
            }
            recognizeStream = null;
        }
    };

    // --- Tratamento de Mensagens do Cliente WebSocket ---
    ws.on('message', (message: Buffer | string) => {
        if (typeof message === 'string') {
            // Tratamento de comandos
            try {
                const command = JSON.parse(message);
                if (command.command === 'stopStreaming') {
                    console.log("Recebido comando 'stopStreaming' do cliente.");
                    if (recognizeStream && !recognizeStream.destroyed) {
                        console.log("Finalizando stream de escrita para Google API...");
                        recognizeStream.end();
                    }
                } else {
                    console.log("Recebido comando JSON desconhecido:", command);
                }
            } catch (e) {
                console.warn("Recebida mensagem string que não é um JSON de comando válido:", message);
            }
        } else if (message instanceof Buffer) {
            // Tratamento de dados de áudio (Buffer)

            // --- REINTRODUZIDA A CORREÇÃO PARA RangeError ---
            // Precisamos copiar o buffer para garantir o alinhamento para Float32Array.
            let float32Array: Float32Array;
            try {
                const alignedBuffer = new ArrayBuffer(message.length);
                const byteView = new Uint8Array(alignedBuffer);
                byteView.set(message); // Copia o conteúdo
                // Cria a view a partir do buffer copiado e alinhado
                float32Array = new Float32Array(alignedBuffer, 0, alignedBuffer.byteLength / Float32Array.BYTES_PER_ELEMENT);
            } catch (conversionError) {
                 console.error("Erro ao converter Buffer para Float32Array:", conversionError);
                 return; // Não processa este chunk
            }
            // --- Fim da Correção ---

            // Converte para Int16
            const int16Array = new Int16Array(float32Array.length);
            for (let i = 0; i < float32Array.length; i++) {
                int16Array[i] = Math.max(-32768, Math.min(32767, float32Array[i] * 32767));
            }

            // Envia para o Google
            if (recognizeStream && !recognizeStream.destroyed && recognizeStream.writable) {
                 recognizeStream.write(int16Array);
            } else if (!recognizeStream || recognizeStream.destroyed) {
                if (!recognizeStream) {
                     console.log("Primeiro chunk de áudio recebido, iniciando stream para Google.");
                     startGoogleStream();
                     setTimeout(() => {
                         if (recognizeStream && !recognizeStream.destroyed && recognizeStream.writable) {
                             recognizeStream.write(int16Array);
                         }
                     }, 50);
                } else {
                    console.warn("Stream destruído, não é possível enviar áudio.");
                }
            }
        } else {
            console.log("Recebida mensagem de tipo inesperado:", typeof message);
        }
    });

    // --- Tratamento de Fechamento e Erros da Conexão WebSocket ---
    ws.on('close', (code: number, reason: Buffer) => {
        const reasonString = reason.toString() || 'Sem razão especificada';
        console.log(`Cliente desconectado. Código: ${code}, Razão: ${reasonString}`);
        if (recognizeStream && !recognizeStream.destroyed) {
            console.log('Cliente desconectado, finalizando stream para Google API.');
            recognizeStream.end();
            recognizeStream.destroy();
        }
        recognizeStream = null;
    });

    ws.on('error', (error: Error) => {
        console.error('Erro na conexão WebSocket do cliente:', error);
        if (recognizeStream && !recognizeStream.destroyed) {
            console.log('Erro no WebSocket do cliente, destruindo stream para Google API.');
            recognizeStream.destroy(error);
        }
        recognizeStream = null;
    });
});

// --- Tratamento de Erros do Servidor WebSocket ---
wss.on('error', (error: Error) => {
    console.error('Erro fatal no servidor WebSocket:', error);
});

console.log('Handler de conexão WebSocket configurado e aguardando conexões.');
