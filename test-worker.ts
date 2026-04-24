
const workerCode = `
  console.log("Worker started");
  postMessage("Hello from worker");
`;

const worker = new Worker("data:text/javascript," + encodeURIComponent(workerCode));
worker.onmessage = (event) => {
  console.log("Main thread received:", event.data);
  process.exit(0);
};
worker.onerror = (err) => {
  console.error("Worker error:", err);
  process.exit(1);
};
setTimeout(() => {
  console.error("Timeout");
  process.exit(1);
}, 2000);
