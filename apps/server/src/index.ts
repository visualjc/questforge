import { createServer } from "./server.js";

const server = createServer();

server.start({
  transportType: "stdio",
});
