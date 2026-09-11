import { importRecording } from "../../../../../packages/recording/src/import";
import { ImportFailure } from "../../../../../packages/recording/src/primitives";

self.onmessage = async (event: MessageEvent<File>): Promise<void> => {
  try {
    const recording = await importRecording(await event.data.arrayBuffer());
    self.postMessage({ recording });
  } catch (error) {
    self.postMessage({ diagnostic: error instanceof ImportFailure
      ? { code: error.code, message: error.message }
      : { code: "import_failed", message: "Recording could not be validated. No new records were admitted." } });
  }
};
