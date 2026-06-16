import test from "node:test";
import assert from "node:assert/strict";
import { translations } from "../../src/features/i18n/translations";

test("translation catalogs expose the same complete key set", () => {
  const englishKeys = Object.keys(translations.en).sort();
  const chineseKeys = Object.keys(translations.zh).sort();

  assert.deepEqual(chineseKeys, englishKeys);
  for (const locale of ["en", "zh"] as const) {
    for (const [key, value] of Object.entries(translations[locale])) {
      assert.equal(value.trim().length > 0, true, `${locale}.${key} should not be empty`);
    }
  }
});

test("Chinese translations are readable and do not contain mojibake markers", () => {
  const serialized = JSON.stringify(translations.zh);

  assert.match(serialized, /项目设置/);
  assert.match(serialized, /新建项目/);
  assert.doesNotMatch(serialized, /锟|�|鏂|鐢|绋|浣|鍗|瑙|鎼|杈|缃|勬|嬫|€|\?/u);
});

test("translation catalog includes shared keys for the current app shell", () => {
  const requiredKeys = [
    "topbar.goToTaskCards",
    "topbar.switchToEnglish",
    "topbar.switchToChinese",
    "workspace.runTrace",
    "workspace.preparingResponse",
    "workspace.askAiPlaceholder",
    "workspace.send",
    "workspace.sending",
    "workspace.resetCanvas",
    "workspace.undoCanvas",
    "plan.confirmAndRun",
    "canvasWrite.proposal",
    "common.cancel",
    "common.retry"
  ];

  for (const key of requiredKeys) {
    assert.equal(Object.hasOwn(translations.en, key), true, `${key} missing from English catalog`);
    assert.equal(Object.hasOwn(translations.zh, key), true, `${key} missing from Chinese catalog`);
  }
});
