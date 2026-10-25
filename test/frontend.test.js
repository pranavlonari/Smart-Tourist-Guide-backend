"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const pagesRouter = require("../src/routes/pages");

const frontendPath = path.resolve(__dirname, "../../frontend");

test("frontend is made only of HTML and CSS without browser JavaScript", () => {
  const files = readdirSync(frontendPath);
  assert.ok(files.length > 0);
  assert.ok(files.every((file) => [".html", ".css"].includes(path.extname(file))));

  for (const file of files.filter((name) => name.endsWith(".html"))) {
    const html = readFileSync(path.join(frontendPath, file), "utf8");
    assert.doesNotMatch(html, /<script\b/i, `${file} must not contain a script`);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${file} must not contain inline event handlers`);
  }
});

test("public information, admin, and cart pages are present with server-backed forms", () => {
  const expected = {
    "about.html": ["Smart Tourist Guide System", "Find your place"],
    "contact.html": ['action="/contact"', 'name="message"'],
    "admin-login.html": ['action="/admin/login"', "Administrator sign in"],
    "cart.html": ["Your cart", "{{CART_ITEMS}}", "{{CART_SUMMARY}}"],
    "profile.html": ['action="/profile"', 'name="phone"', "Personal information"],
    "payment.html": ["Choose how you would like to pay", "{{TRAVELER_EMAIL}}", "{{CHECKOUT_STEPS}}"],
  };

  for (const [file, expectedContent] of Object.entries(expected)) {
    const html = readFileSync(path.join(frontendPath, file), "utf8");
    for (const content of expectedContent) {
      assert.ok(html.includes(content), `${file} should include ${content}`);
    }
  }
});

test("cart and management navigation is available only to signed-in users with the right role", () => {
  const guestActions = pagesRouter.headerActions(null);
  assert.doesNotMatch(guestActions, /href="\/cart"/);
  assert.doesNotMatch(guestActions, /href="\/dashboard"|href="\/admin\/login"/);

  const touristActions = pagesRouter.headerActions({ role: "tourist" });
  assert.match(touristActions, /href="\/cart"/);
  assert.match(touristActions, /href="\/profile"/);
  assert.doesNotMatch(touristActions, /href="\/dashboard"|href="\/admin\/login"/);

  const adminActions = pagesRouter.headerActions({ role: "system_administrator" });
  assert.match(adminActions, /href="\/cart"/);
  assert.match(adminActions, /href="\/dashboard"/);
  assert.doesNotMatch(adminActions, /href="\/admin\/login"/);

  for (const file of readdirSync(frontendPath).filter((name) => name.endsWith(".html"))) {
    const html = readFileSync(path.join(frontendPath, file), "utf8");
    assert.doesNotMatch(html, /<a\b[^>]*href="\/admin\/login"/i, `${file} must not expose admin login navigation`);
  }
});
