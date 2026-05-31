import "./packages/navi/src/index.ts";
import { Provider } from "./packages/navi/src/provider/provider.ts";
import { Effect } from "effect";

async function run() {
  console.log("Loading provider...");
  console.log("Provider properties:", Object.keys(Provider));
  console.log("ListResult:", Provider.ListResult);
  console.log("ConfigProvidersResult:", Provider.ConfigProvidersResult);
  console.log("Done");
}
run().catch(console.error);
