import { runWorker } from "./worker.js";

runWorker().then((message) => console.log(message));
