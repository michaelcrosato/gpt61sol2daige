import { PeerServer } from "peer";

const port = Number(process.env.SIGNAL_PORT ?? 9000);
const server = PeerServer({ port, path: "/fern", allow_discovery: false, concurrent_limit: 128 });
server.on("connection", (client) =>
  console.log(JSON.stringify({ event: "join", id: client.getId() })),
);
server.on("disconnect", (client) =>
  console.log(JSON.stringify({ event: "leave", id: client.getId() })),
);
console.log(`Fern signaling ready on http://localhost:${port}/fern`);
