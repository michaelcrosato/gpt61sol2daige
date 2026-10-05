import { PeerServer } from "peer";

const port = Number(process.env.SIGNAL_PORT ?? 9000);
// IPv4-only containers cannot bind PeerServer's default "::"; SIGNAL_HOST=0.0.0.0 selects IPv4.
const host = process.env.SIGNAL_HOST || undefined;
const server = PeerServer({
  port,
  ...(host ? { host } : {}),
  path: "/fern",
  allow_discovery: false,
  concurrent_limit: 128,
});
server.on("connection", (client) =>
  console.log(JSON.stringify({ event: "join", id: client.getId() })),
);
server.on("disconnect", (client) =>
  console.log(JSON.stringify({ event: "leave", id: client.getId() })),
);
console.log(`Fern signaling ready on http://localhost:${port}/fern`);
