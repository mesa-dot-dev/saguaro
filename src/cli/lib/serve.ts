import { startMcpServer } from '../../mcp/server.js';

const serveHandler = async (): Promise<void> => {
  await startMcpServer({ transport: 'stdio' });
};

export default serveHandler;
