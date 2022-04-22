import * as cache from "@actions/cache";
import * as core from "@actions/core";
import fs from "fs";

import { Events, Inputs, State } from "./constants";
import * as utils from "./utils/actionUtils";

async function run(): Promise<void> {
  try {
    if (!utils.isCacheFeatureAvailable()) {
      utils.setCacheHitOutput(false);
      return;
    }

    // Validate inputs, this can cause task failure
    if (!utils.isValidEvent()) {
      utils.logWarning(
        `Event Validation Error: The event type ${
          process.env[Events.Key]
        } is not supported because it's not tied to a branch or tag ref.`
      );
      return;
    }

    const primaryKey = core.getInput(Inputs.Key, { required: true });
    core.saveState(State.CachePrimaryKey, primaryKey);

    const restoreKeys = utils.getInputAsArray(Inputs.RestoreKeys);
    const cachePaths = utils.getInputAsArray(Inputs.Path, {
      required: true
    });

    try {
      const cacheKey = await cache.restoreCache(["uuids.json"], primaryKey);
      if (!cacheKey) {
        core.info(
          `Cache not found for input keys: ${[primaryKey, ...restoreKeys].join(
            ", "
          )}`
        );
        return;
      }

      if (!fs.existsSync("uuids.json")) {
        core.info("UUIDs File not found for cache");
        return;
      }
      const uuids = JSON.parse(fs.readFileSync("uuids.json", "utf8"));
      for (const uuid of uuids) {
        try {
          const uuidCacheKey = await cache.restoreCache(
            cachePaths,
            uuid,
            restoreKeys
          );
          if (!uuidCacheKey) {
            core.info(
              `Cache not found for input keys: ${[uuid, ...restoreKeys].join(
                ", "
              )}`
            );
            continue;
          }
          core.info(`Cache restored with key: ${uuidCacheKey}`);
        } catch (e) {
          const error = e as Error;
          if (error.name === cache.ValidationError.name) {
            throw error;
          } else {
            utils.logWarning(error.message);
            utils.setCacheHitOutput(false);
          }
        }
      }

      // Store the matched cache key
      utils.setCacheState(cacheKey);

      const isExactKeyMatch = utils.isExactKeyMatch(primaryKey, cacheKey);
      utils.setCacheHitOutput(isExactKeyMatch);

      core.info(`Cache restored from key: ${cacheKey}`);
    } catch (e) {
      const error = e as Error;
      if (error.name === cache.ValidationError.name) {
        throw error;
      } else {
        utils.logWarning(error.message);
        utils.setCacheHitOutput(false);
      }
    }
  } catch (e) {
    const error = e as Error;
    core.setFailed(error.message);
  }
}

run();

export default run;
