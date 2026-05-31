import { rpc } from "./packages/navi/src/cli/cmd/tui/worker.ts";
import { Effect } from "effect";

async function run() {
  console.log("Starting server...");
  const srv = await rpc.server({ port: 3005, hostname: "127.0.0.1" });
  console.log("Server started at:", srv.url);
  
  console.log("Making request to config/providers...");
  try {
    const res = await rpc.fetch({
      url: srv.url + "api/v1/config/providers?instance=v:/pankaj",
      method: "GET",
      headers: {}
    });
    console.log("Response status:", res.status);
    console.log("Response body:", res.body.substring(0, 100));
  } catch (err) {
    console.error("Fetch failed:", err);
  }

  console.log("Making request to provider/list...");
  try {
    const res = await rpc.fetch({
      url: srv.url + "api/v1/provider?instance=v:/pankaj",
      method: "GET",
      headers: {}
    });
    console.log("Response status:", res.status);
    console.log("Response body:", res.body.substring(0, 100));
  } catch (err) {
    console.error("Fetch failed:", err);
  }
  
  await rpc.shutdown();
  process.exit(0);
}
run().catch(console.error);
