import * as cache from "@actions/cache";
import * as core from "@actions/core";
import fs from "fs";
import path from "path";

import { Events, Inputs, RefKey } from "../src/constants";
import run from "../src/restore";
import * as actionUtils from "../src/utils/actionUtils";
import * as testUtils from "../src/utils/testUtils";

jest.mock("../src/utils/actionUtils");
jest.setTimeout(50000);

beforeAll(() => {
  jest
    .spyOn(actionUtils, "isExactKeyMatch")
    .mockImplementation((key, cacheResult) => {
      const actualUtils = jest.requireActual("../src/utils/actionUtils");
      return actualUtils.isExactKeyMatch(key, cacheResult);
    });

  jest.spyOn(actionUtils, "isValidEvent").mockImplementation(() => {
    const actualUtils = jest.requireActual("../src/utils/actionUtils");
    return actualUtils.isValidEvent();
  });

  jest
    .spyOn(actionUtils, "getInputAsArray")
    .mockImplementation((name, options) => {
      const actualUtils = jest.requireActual("../src/utils/actionUtils");
      return actualUtils.getInputAsArray(name, options);
    });
});

beforeEach(() => {
  process.env[Events.Key] = Events.Push;
  process.env[RefKey] = "refs/heads/feature-branch";

  jest.spyOn(actionUtils, "isGhes").mockImplementation(() => false);
  jest
    .spyOn(actionUtils, "isCacheFeatureAvailable")
    .mockImplementation(() => true);
});

afterEach(() => {
  testUtils.clearInputs();
  delete process.env[Events.Key];
  delete process.env[RefKey];
});

test("restore with invalid event outputs warning", async () => {
  const logWarningMock = jest.spyOn(actionUtils, "logWarning");
  const failedMock = jest.spyOn(core, "setFailed");
  const invalidEvent = "commit_comment";
  process.env[Events.Key] = invalidEvent;
  delete process.env[RefKey];
  await run();
  expect(logWarningMock).toHaveBeenCalledWith(
    `Event Validation Error: The event type ${invalidEvent} is not supported because it's not tied to a branch or tag ref.`
  );
  expect(failedMock).toHaveBeenCalledTimes(0);
});

test("restore without AC available should no-op", async () => {
  jest.spyOn(actionUtils, "isGhes").mockImplementation(() => false);
  jest
    .spyOn(actionUtils, "isCacheFeatureAvailable")
    .mockImplementation(() => false);

  const restoreCacheMock = jest.spyOn(cache, "restoreCache");
  const setCacheHitOutputMock = jest.spyOn(actionUtils, "setCacheHitOutput");

  await run();

  expect(restoreCacheMock).toHaveBeenCalledTimes(0);
  expect(setCacheHitOutputMock).toHaveBeenCalledTimes(1);
  expect(setCacheHitOutputMock).toHaveBeenCalledWith(false);
});

test("restore on GHES without AC available should no-op", async () => {
  jest.spyOn(actionUtils, "isGhes").mockImplementation(() => true);
  jest
    .spyOn(actionUtils, "isCacheFeatureAvailable")
    .mockImplementation(() => false);

  const restoreCacheMock = jest.spyOn(cache, "restoreCache");
  const setCacheHitOutputMock = jest.spyOn(actionUtils, "setCacheHitOutput");

  await run();

  expect(restoreCacheMock).toHaveBeenCalledTimes(0);
  expect(setCacheHitOutputMock).toHaveBeenCalledTimes(1);
  expect(setCacheHitOutputMock).toHaveBeenCalledWith(false);
});

test("restore on GHES with AC available ", async () => {
  jest.spyOn(actionUtils, "isGhes").mockImplementation(() => true);
  const cachePath = "__tests__/test-build";
  const key = "node-test";
  testUtils.setInputs({
    path: cachePath,
    key
  });
  const uuid = fs.readFileSync(
    path.resolve(__dirname, "test-build", "uuid"),
    "utf8"
  );

  const infoMock = jest.spyOn(core, "info");
  const failedMock = jest.spyOn(core, "setFailed");
  const stateMock = jest.spyOn(core, "saveState");
  const setCacheHitOutputMock = jest.spyOn(actionUtils, "setCacheHitOutput");
  const restoreCacheMock = jest
    .spyOn(cache, "restoreCache")
    .mockImplementation(() => {
      return Promise.resolve(key);
    });

  await run();

  expect(restoreCacheMock).toHaveBeenCalledTimes(2);
  expect(restoreCacheMock).toHaveBeenCalledWith(["uuids.json"], key);
  expect(restoreCacheMock).toHaveBeenCalledWith([cachePath], uuid, []);

  expect(stateMock).toHaveBeenCalledWith("CACHE_KEY", key);
  expect(setCacheHitOutputMock).toHaveBeenCalledTimes(1);
  expect(setCacheHitOutputMock).toHaveBeenCalledWith(true);

  expect(infoMock).toHaveBeenCalledWith(`Cache restored from key: ${key}`);
  expect(failedMock).toHaveBeenCalledTimes(0);
});

test("restore with no path should fail", async () => {
  const failedMock = jest.spyOn(core, "setFailed");
  const restoreCacheMock = jest.spyOn(cache, "restoreCache");
  await run();
  expect(restoreCacheMock).toHaveBeenCalledTimes(0);
  // this input isn't necessary for restore b/c tarball contains entries relative to workspace
  expect(failedMock).not.toHaveBeenCalledWith(
    "Input required and not supplied: path"
  );
});

test("restore with no key", async () => {
  testUtils.setInput(Inputs.Path, "node_modules");
  const failedMock = jest.spyOn(core, "setFailed");
  const restoreCacheMock = jest.spyOn(cache, "restoreCache");
  await run();
  expect(restoreCacheMock).toHaveBeenCalledTimes(0);
  expect(failedMock).toHaveBeenCalledWith(
    "Input required and not supplied: key"
  );
});

test.skip("restore with too many keys should fail", async () => {
  const path = "__tests__/test-build";
  const key = "node-test";
  const restoreKeys = [...Array(20).keys()].map(x => x.toString());
  testUtils.setInputs({
    path: path,
    key,
    restoreKeys
  });
  const failedMock = jest.spyOn(core, "setFailed");
  const restoreCacheMock = jest.spyOn(cache, "restoreCache");
  await run();
  expect(restoreCacheMock).toHaveBeenCalledTimes(1);
  expect(restoreCacheMock).toHaveBeenCalledWith(["uuids.json"], key);
  expect(failedMock).toHaveBeenCalledWith(
    `Key Validation Error: Keys are limited to a maximum of 10.`
  );
});

test.skip("restore with large key should fail", async () => {
  const path = "__tests__/test-build";
  const key = "foo".repeat(512); // Over the 512 character limit
  testUtils.setInputs({
    path: path,
    key
  });
  const failedMock = jest.spyOn(core, "setFailed");
  const restoreCacheMock = jest.spyOn(cache, "restoreCache");
  await run();
  expect(restoreCacheMock).toHaveBeenCalledTimes(1);
  expect(restoreCacheMock).toHaveBeenCalledWith(["uuids.json"], key);
  expect(failedMock).toHaveBeenCalledWith(
    `Key Validation Error: ${key} cannot be larger than 512 characters.`
  );
});

test.skip("restore with invalid key should fail", async () => {
  const path = "__tests__/test-build";
  const key = "comma,comma";
  testUtils.setInputs({
    path: path,
    key
  });
  const failedMock = jest.spyOn(core, "setFailed");
  const restoreCacheMock = jest.spyOn(cache, "restoreCache");
  await run();
  expect(restoreCacheMock).toHaveBeenCalledTimes(1);
  expect(restoreCacheMock).toHaveBeenCalledWith(["uuids.json"], key);
  expect(failedMock).toHaveBeenCalledWith(
    `Key Validation Error: ${key} cannot contain commas.`
  );
});

test("restore with no cache found", async () => {
  const path = "__tests__/test-build";
  const key = "node-test";
  testUtils.setInputs({
    path: path,
    key
  });

  const infoMock = jest.spyOn(core, "info");
  const failedMock = jest.spyOn(core, "setFailed");
  const stateMock = jest.spyOn(core, "saveState");
  const restoreCacheMock = jest
    .spyOn(cache, "restoreCache")
    .mockImplementation(() => {
      return Promise.resolve(undefined);
    });

  await run();

  expect(restoreCacheMock).toHaveBeenCalledTimes(1);
  expect(restoreCacheMock).toHaveBeenCalledWith(["uuids.json"], key);

  expect(stateMock).toHaveBeenCalledWith("CACHE_KEY", key);
  expect(failedMock).toHaveBeenCalledTimes(0);

  expect(infoMock).toHaveBeenCalledWith(
    `Cache not found for input keys: ${key}`
  );
});

test("restore with server error should fail", async () => {
  const path = "__tests__/test-build";
  const key = "node-test";
  testUtils.setInputs({
    path: path,
    key
  });

  const logWarningMock = jest.spyOn(actionUtils, "logWarning");
  const failedMock = jest.spyOn(core, "setFailed");
  const stateMock = jest.spyOn(core, "saveState");
  const restoreCacheMock = jest
    .spyOn(cache, "restoreCache")
    .mockImplementationOnce(() => {
      throw new Error("HTTP Error Occurred");
    });
  const setCacheHitOutputMock = jest.spyOn(actionUtils, "setCacheHitOutput");

  await run();

  expect(restoreCacheMock).toHaveBeenCalledTimes(1);
  expect(restoreCacheMock).toHaveBeenCalledWith(["uuids.json"], key);

  expect(stateMock).toHaveBeenCalledWith("CACHE_KEY", key);

  expect(logWarningMock).toHaveBeenCalledTimes(1);
  expect(logWarningMock).toHaveBeenCalledWith("HTTP Error Occurred");

  expect(setCacheHitOutputMock).toHaveBeenCalledTimes(1);
  expect(setCacheHitOutputMock).toHaveBeenCalledWith(false);

  expect(failedMock).toHaveBeenCalledTimes(0);
});

test.skip("restore with restore keys and no cache found", async () => {
  const path = "__tests__/test-build";
  const key = "node-test";
  const restoreKey = "node-";
  testUtils.setInputs({
    path: path,
    key,
    restoreKeys: [restoreKey]
  });

  const infoMock = jest.spyOn(core, "info");
  const failedMock = jest.spyOn(core, "setFailed");
  const stateMock = jest.spyOn(core, "saveState");
  const restoreCacheMock = jest
    .spyOn(cache, "restoreCache")
    .mockImplementation(() => {
      return Promise.resolve(undefined);
    });

  await run();

  expect(restoreCacheMock).toHaveBeenCalledTimes(1);
  expect(restoreCacheMock).toHaveBeenCalledWith(["uuids.json"], key);

  expect(stateMock).toHaveBeenCalledWith("CACHE_KEY", key);
  expect(failedMock).toHaveBeenCalledTimes(0);

  expect(infoMock).toHaveBeenCalledWith(
    `Cache not found for input keys: ${key}, ${restoreKey}`
  );
});

test.skip("restore with cache found for key", async () => {
  const cachePath = "__tests__/test-build";
  const key = "node-test";
  testUtils.setInputs({
    path: cachePath,
    key
  });
  const uuid = fs.readFileSync(
    path.resolve(__dirname, "test-build", "uuid"),
    "utf8"
  );

  const infoMock = jest.spyOn(core, "info");
  const failedMock = jest.spyOn(core, "setFailed");
  const stateMock = jest.spyOn(core, "saveState");
  const setCacheHitOutputMock = jest.spyOn(actionUtils, "setCacheHitOutput");
  const restoreCacheMock = jest
    .spyOn(cache, "restoreCache")
    .mockImplementationOnce(() => {
      return Promise.resolve(key);
    });

  await run();

  expect(restoreCacheMock).toHaveBeenCalledTimes(2);
  expect(restoreCacheMock).toHaveBeenCalledWith(["uuids.json"], key);
  expect(restoreCacheMock).toHaveBeenCalledWith([cachePath], uuid, []);

  expect(stateMock).toHaveBeenCalledWith("CACHE_KEY", key);
  expect(setCacheHitOutputMock).toHaveBeenCalledTimes(2);
  expect(setCacheHitOutputMock).toHaveBeenCalledWith(true);

  expect(infoMock).toHaveBeenCalledWith(`Cache restored from key: ${key}`);
  expect(failedMock).toHaveBeenCalledTimes(0);
});

test.skip("restore with cache found for restore key", async () => {
  const path = "node_modules";
  const key = "node-test";
  const restoreKey = "node-";
  testUtils.setInputs({
    path: path,
    key,
    restoreKeys: [restoreKey]
  });

  const infoMock = jest.spyOn(core, "info");
  const failedMock = jest.spyOn(core, "setFailed");
  const stateMock = jest.spyOn(core, "saveState");
  const setCacheHitOutputMock = jest.spyOn(actionUtils, "setCacheHitOutput");
  const restoreCacheMock = jest
    .spyOn(cache, "restoreCache")
    .mockImplementationOnce(() => {
      return Promise.resolve(restoreKey);
    });

  await run();

  expect(restoreCacheMock).toHaveBeenCalledTimes(1);
  expect(restoreCacheMock).toHaveBeenCalledWith([path], key, [restoreKey]);

  expect(stateMock).toHaveBeenCalledWith("CACHE_KEY", key);
  expect(setCacheHitOutputMock).toHaveBeenCalledTimes(1);
  expect(setCacheHitOutputMock).toHaveBeenCalledWith(false);

  expect(infoMock).toHaveBeenCalledWith(
    `Cache restored from key: ${restoreKey}`
  );
  expect(failedMock).toHaveBeenCalledTimes(0);
});
