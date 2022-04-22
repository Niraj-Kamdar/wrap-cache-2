import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as glob from "@actions/glob";
import fs from "fs";
import path from "path";

import { Events, Inputs, State } from "./constants";
import * as utils from "./utils/actionUtils";

// TODO: fix logic for save and restore with key and restore-keys
// NOTE: current logic works but not very good.
// Catch and log any unhandled exceptions.  These exceptions can leak out of the uploadChunk method in
// @actions/toolkit when a failed upload closes the file descriptor causing any in-process reads to
// throw an uncaught exception.  Instead of failing this action, just warn.
process.on("uncaughtException", e => utils.logWarning(e.message));

async function run(): Promise<void> {
  try {
    if (!utils.isCacheFeatureAvailable()) {
      return;
    }

    if (!utils.isValidEvent()) {
      utils.logWarning(
        `Event Validation Error: The event type ${
          process.env[Events.Key]
        } is not supported because it's not tied to a branch or tag ref.`
      );
      return;
    }

    const state = utils.getCacheState();

    // Inputs are re-evaluted before the post action, so we want the original key used for restore
    const primaryKey = core.getState(State.CachePrimaryKey);
    if (!primaryKey) {
      utils.logWarning(`Error retrieving key from state.`);
      return;
    }

    if (utils.isExactKeyMatch(primaryKey, state)) {
      core.info(
        `Cache hit occurred on the primary key ${primaryKey}, not saving cache.`
      );
      return;
    }

    const cachePaths = utils.getInputAsArray(Inputs.Path, {
      required: true
    });

    for (const cachePath of cachePaths) {
      const globber = await glob.create(cachePath.trim());

      const uuids: string[] = [];
      for await (const dir of globber.globGenerator()) {
        const uuidFile = path.join(dir, "uuid");
        if (!fs.existsSync(uuidFile)) {
          utils.logWarning("UUID file not found for cache");
          continue;
        }
        const uuid = fs.readFileSync(uuidFile, "utf8");
        try {
          await cache.saveCache([dir], uuid, {
            uploadChunkSize: utils.getInputAsInt(Inputs.UploadChunkSize)
          });
          uuids.push(uuid);
        } catch (e) {
          const error = e as Error;
          if (error.name === cache.ValidationError.name) {
            throw error;
          } else if (error.name === cache.ReserveCacheError.name) {
            core.info(error.message);
          } else {
            utils.logWarning(error.message);
          }
        }
      }

      fs.writeFileSync("uuids.json", JSON.stringify(uuids));
    }

    try {
      await cache.saveCache(["uuids.json"], primaryKey, {
        uploadChunkSize: utils.getInputAsInt(Inputs.UploadChunkSize)
      });
      core.info(`Cache saved with key: ${primaryKey}`);
    } catch (e) {
      const error = e as Error;
      if (error.name === cache.ValidationError.name) {
        throw error;
      } else if (error.name === cache.ReserveCacheError.name) {
        core.info(error.message);
      } else {
        utils.logWarning(error.message);
      }
    }
  } catch (e) {
    const error = e as Error;
    utils.logWarning(error.message);
  }
}

run();

export default run;
