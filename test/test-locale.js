const loc = require("locale");

exports.testPrefered = function(assert) {
    console.log(loc.getPreferedLocales());
    assert.ok(loc.getPreferedLocales().length >= 1, 
	      "get locales");
};

exports.testLocale = function(assert) {
    assert.ok(loc.getLocale() === 'en-US', 
	      "get current locale");
};

exports.testSDKLocale = function(assert) {
    const sdkloc = require("sdk/l10n");
    assert.ok(sdkloc.get("locale") === 'locale', 
	      "sdk translate still broken");
};

exports.testTranslateEnglish = function(assert) {
    assert.ok(loc.get("locale") === 'en-US', "translate");
};

require("sdk/test").run(exports);
