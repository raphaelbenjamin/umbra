import assert from "node:assert/strict";
import test from "node:test";
import { loadReaderDictionary } from "../src/views/reader/dictionaryLookup.ts";

const entry = (word) => ({ entries: [{ word, pos: "", ipa: "", glosses: [word] }] });
const noListener = async () => () => {};

test("a slower lookup cannot overwrite a word clicked after it", async () => {
  const first = Promise.withResolvers();
  const second = Promise.withResolvers();
  const results = [];
  const closeFirst = loadReaderDictionary("zh", () => first.promise, noListener, (result) => results.push(result));
  closeFirst();
  const closeSecond = loadReaderDictionary("zh", () => second.promise, noListener, (result) => results.push(result));
  second.resolve(entry("书"));
  await second.promise;
  first.resolve(entry("本"));
  await first.promise;
  closeSecond();
  assert.deepEqual(results, [entry("书")]);
});

test("a download retry is scoped to the active word and language", async () => {
  const retry = Promise.withResolvers();
  const subscribed = Promise.withResolvers();
  const pending = { entries: [], pending: true };
  const results = [];
  let requests = 0;
  let unsubscribed = false;
  const close = loadReaderDictionary(
    "he",
    () => ++requests === 1 ? Promise.resolve(pending) : retry.promise,
    async (onChange) => {
      subscribed.resolve(onChange);
      return () => { unsubscribed = true; };
    },
    (result) => results.push(result),
  );
  const onChange = await subscribed.promise;
  onChange("zh");
  assert.equal(requests, 1);
  onChange("he");
  onChange("he");
  assert.equal(requests, 2);
  close();
  retry.resolve(entry("שנה"));
  await retry.promise;
  assert.deepEqual(results, [pending]);
  assert.equal(unsubscribed, true);
});
