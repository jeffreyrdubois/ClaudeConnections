import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import crypto from "crypto";
import express, { Request, Response } from "express";
import { z } from "zod";

// ── Config ────────────────────────────────────────────────────────────────────

const TB_EMAIL = process.env.TB_EMAIL ?? "";
const TB_PASSWORD = process.env.TB_PASSWORD ?? "";
const TB_DEFAULT_STORE_ID = process.env.TB_DEFAULT_STORE_ID ?? "";
const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID ?? "mcp-tacobell";
const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET;
const PORT = parseInt(process.env.PORT ?? "3000");

// Taco Bell web API base URL.
// NOTE: These endpoints were reverse-engineered from the Taco Bell website and
// unofficial community libraries. They are not officially documented and may
// change at any time. If a tool fails with 4xx errors, the endpoint may need
// updating to match Taco Bell's current backend.
const TB_BASE = "https://www.tacobell.com";

// ── Session State ─────────────────────────────────────────────────────────────
// A single in-memory session is maintained for the lifetime of the server.
// This holds the authenticated cookie jar, CSRF token, and the selected store.

interface Session {
  cookieJar: Record<string, string>;
  csrfToken: string;
  storeId: string;
  storeName: string;
  storeAddress: string;
  isLoggedIn: boolean;
}

const session: Session = {
  cookieJar: {},
  csrfToken: "",
  storeId: TB_DEFAULT_STORE_ID,
  storeName: "",
  storeAddress: "",
  isLoggedIn: false,
};

// ── Cookie Helpers ────────────────────────────────────────────────────────────

function serializeCookies(): string {
  return Object.entries(session.cookieJar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function ingestSetCookieHeaders(res: globalThis.Response): void {
  // Node 18+ fetch exposes Set-Cookie via getSetCookie()
  const headers = (res.headers as any).getSetCookie?.() as string[] | undefined
    ?? res.headers.get("set-cookie")?.split(",") // fallback
    ?? [];
  for (const header of headers) {
    const [nameVal] = header.split(";");
    const eqIdx = nameVal.indexOf("=");
    if (eqIdx === -1) continue;
    const name = nameVal.slice(0, eqIdx).trim();
    const val = nameVal.slice(eqIdx + 1).trim();
    if (name) session.cookieJar[name] = val;
  }
}

// ── HTTP Helpers ──────────────────────────────────────────────────────────────

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function tbFetch(
  path: string,
  options: RequestInit & { params?: Record<string, string> } = {}
): Promise<globalThis.Response> {
  const url = new URL(`${TB_BASE}${path}`);
  if (options.params) {
    for (const [k, v] of Object.entries(options.params)) url.searchParams.set(k, v);
  }

  const headers: Record<string, string> = {
    "User-Agent": BROWSER_UA,
    "Accept": "application/json, text/html, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "X-Requested-With": "XMLHttpRequest",
    "Cookie": serializeCookies(),
    ...(session.csrfToken ? { "CSRFToken": session.csrfToken } : {}),
    ...(options.headers as Record<string, string> ?? {}),
  };

  const res = await fetch(url.toString(), { ...options, headers });
  ingestSetCookieHeaders(res);
  return res;
}

async function tbGet(path: string, params?: Record<string, string>): Promise<any> {
  const res = await tbFetch(path, { method: "GET", params });
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function tbPost(path: string, body: Record<string, string>, asJson = false): Promise<any> {
  const res = await tbFetch(path, {
    method: "POST",
    headers: {
      "Content-Type": asJson
        ? "application/json"
        : "application/x-www-form-urlencoded",
      "Referer": TB_BASE,
    },
    body: asJson ? JSON.stringify(body) : new URLSearchParams(body).toString(),
  });
  if (!res.ok) throw new Error(`POST ${path} → HTTP ${res.status}: ${await res.text()}`);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

// ── CSRF Bootstrap ────────────────────────────────────────────────────────────
// Fetch the homepage to seed the cookie jar and extract the CSRF token.

async function ensureCsrfToken(): Promise<void> {
  if (session.csrfToken) return;

  const res = await tbFetch("/", { method: "GET" });
  const html = await res.text();

  // Taco Bell embeds the CSRF token in a <meta name="CSRFToken"> tag
  const match = html.match(/name=["']CSRFToken["'][^>]*content=["']([^"']+)["']/i)
    ?? html.match(/content=["']([^"']+)["'][^>]*name=["']CSRFToken["']/i);

  if (match) {
    session.csrfToken = match[1];
  } else {
    // Some responses put it directly in a cookie
    session.csrfToken = session.cookieJar["CSRFToken"] ?? "";
  }
}

// ── Taco Bell Menu Data ───────────────────────────────────────────────────────
// A snapshot of the Taco Bell menu. Product codes follow the pattern used by
// the Hybris-based tacobell.com backend (as documented by the community library
// taco-bell-python). Update codes here if items change.

interface MenuItem {
  code: string;
  name: string;
  category: string;
  description: string;
  calories: string;
  price: string;
  customizable: boolean;
}

const MENU: MenuItem[] = [
  // Tacos
  { code: "CRUNCHY_TACO", name: "Crunchy Taco", category: "Tacos", description: "Seasoned beef, lettuce, cheddar cheese in a crunchy shell.", calories: "170", price: "$1.89", customizable: true },
  { code: "CRUNCHY_TACO_SUPREME", name: "Crunchy Taco Supreme", category: "Tacos", description: "Seasoned beef, lettuce, cheddar, tomato, reduced-fat sour cream.", calories: "190", price: "$2.49", customizable: true },
  { code: "SOFT_TACO", name: "Soft Taco", category: "Tacos", description: "Seasoned beef, lettuce, cheddar cheese in a warm flour tortilla.", calories: "180", price: "$1.89", customizable: true },
  { code: "SOFT_TACO_SUPREME", name: "Soft Taco Supreme", category: "Tacos", description: "Seasoned beef, lettuce, cheddar, tomato, reduced-fat sour cream in flour tortilla.", calories: "210", price: "$2.49", customizable: true },
  { code: "DLT_NACHO_CHEESE", name: "Nacho Cheese Doritos Locos Taco", category: "Tacos", description: "Seasoned beef, lettuce, cheddar in a Nacho Cheese Doritos shell.", calories: "170", price: "$2.19", customizable: true },
  { code: "DLT_COOL_RANCH", name: "Cool Ranch Doritos Locos Taco", category: "Tacos", description: "Seasoned beef, lettuce, cheddar in a Cool Ranch Doritos shell.", calories: "170", price: "$2.19", customizable: true },
  { code: "SPICY_POTATO_SOFT_TACO", name: "Spicy Potato Soft Taco", category: "Tacos", description: "Crispy potatoes, lettuce, reduced-fat sour cream, chipotle sauce in a flour tortilla.", calories: "230", price: "$1.89", customizable: true },
  // Burritos
  { code: "BEAN_BURRITO", name: "Bean Burrito", category: "Burritos", description: "Seasoned beans, cheddar, onions, red sauce in a warm flour tortilla.", calories: "350", price: "$1.89", customizable: true },
  { code: "BURRITO_SUPREME", name: "Burrito Supreme", category: "Burritos", description: "Seasoned beef, beans, cheddar, lettuce, tomato, onions, reduced-fat sour cream, red sauce.", calories: "400", price: "$4.79", customizable: true },
  { code: "CHEESY_BEAN_RICE_BURRITO", name: "Cheesy Bean and Rice Burrito", category: "Burritos", description: "Seasoned rice, seasoned beans, nacho cheese sauce, chipotle sauce.", calories: "420", price: "$2.99", customizable: true },
  { code: "FIVE_LAYER_BURRITO", name: "Beefy 5-Layer Burrito", category: "Burritos", description: "Seasoned beef, nacho cheese sauce, seasoned beans, reduced-fat sour cream, cheddar.", calories: "490", price: "$3.49", customizable: true },
  { code: "CHIPOTLE_RANCH_GRILLED_CHICKEN_BURRITO", name: "Chipotle Ranch Grilled Chicken Burrito", category: "Burritos", description: "Grilled chicken, low-fat chipotle sauce, rice, seasoned beans, pico de gallo.", calories: "510", price: "$5.49", customizable: true },
  // Quesadillas
  { code: "CHEESE_QUESADILLA", name: "Cheese Quesadilla", category: "Quesadillas", description: "Three-cheese blend, creamy jalapeño sauce grilled in a flour tortilla.", calories: "470", price: "$3.49", customizable: true },
  { code: "CHICKEN_QUESADILLA", name: "Chicken Quesadilla", category: "Quesadillas", description: "Grilled chicken, three-cheese blend, creamy jalapeño sauce.", calories: "510", price: "$4.99", customizable: true },
  { code: "STEAK_QUESADILLA", name: "Steak Quesadilla", category: "Quesadillas", description: "Grilled steak, three-cheese blend, creamy jalapeño sauce.", calories: "520", price: "$5.49", customizable: true },
  // Nachos & Sides
  { code: "NACHOS_BELLGRANDE", name: "Nachos BellGrande", category: "Nachos & Sides", description: "Tortilla chips, seasoned beef, nacho cheese sauce, tomatoes, reduced-fat sour cream, jalapeños.", calories: "740", price: "$5.49", customizable: true },
  { code: "NACHOS_CHEESE", name: "Nachos", category: "Nachos & Sides", description: "Tortilla chips with warm nacho cheese sauce.", calories: "330", price: "$1.99", customizable: false },
  { code: "CHIPS_SALSA", name: "Chips and Nacho Cheese Sauce", category: "Nachos & Sides", description: "Warm nacho cheese sauce served alongside chips.", calories: "220", price: "$1.99", customizable: false },
  { code: "CINNAMON_TWISTS", name: "Cinnamon Twists", category: "Nachos & Sides", description: "Light, crunchy, airy puffed corn twists rolled in cinnamon sugar.", calories: "170", price: "$1.89", customizable: false },
  { code: "HASH_BROWN", name: "Hash Brown", category: "Nachos & Sides", description: "Golden, crispy seasoned potato hash brown.", calories: "180", price: "$1.29", customizable: false },
  // Power Bowls
  { code: "CHICKEN_POWER_BOWL", name: "Chicken Power Bowl", category: "Power Bowls", description: "Grilled chicken, seasoned rice, seasoned black beans, pico de gallo, guacamole, reduced-fat sour cream, cheddar.", calories: "480", price: "$6.99", customizable: true },
  { code: "VEGGIE_POWER_BOWL", name: "Veggie Power Bowl", category: "Power Bowls", description: "Seasoned rice, seasoned black beans, pico de gallo, guacamole, reduced-fat sour cream, cheddar.", calories: "430", price: "$6.49", customizable: true },
  // Specialties
  { code: "CHALUPA_SUPREME", name: "Chalupa Supreme", category: "Specialties", description: "Seasoned beef, lettuce, tomatoes, cheddar, reduced-fat sour cream in a chalupa shell.", calories: "350", price: "$3.99", customizable: true },
  { code: "GORDITA_CRUNCH", name: "Gordita Crunch", category: "Specialties", description: "Seasoned beef, lettuce, cheddar, chipotle sauce, sandwiched between a flatbread and a crunchy shell.", calories: "370", price: "$3.99", customizable: true },
  { code: "CRUNCHWRAP_SUPREME", name: "Crunchwrap Supreme", category: "Specialties", description: "Seasoned beef, nacho cheese sauce, tostada shell, reduced-fat sour cream, lettuce, tomatoes, cheddar.", calories: "520", price: "$4.99", customizable: true },
  { code: "MEXICAN_PIZZA", name: "Mexican Pizza", category: "Specialties", description: "Two crispy pizza shells layered with seasoned beef, beans, pizza sauce, cheddar, pizza sauce, and diced tomatoes.", calories: "540", price: "$4.99", customizable: true },
  // Breakfast
  { code: "BFAST_CRUNCHWRAP", name: "Breakfast Crunchwrap", category: "Breakfast", description: "Scrambled eggs, sausage, hash brown, cheddar, creamy jalapeño sauce.", calories: "680", price: "$3.99", customizable: true },
  { code: "BFAST_BURRITO_GRANDE", name: "Grande Scrambler Burrito", category: "Breakfast", description: "Scrambled eggs, seasoned beef, seasoned rice, reduced-fat sour cream, cheddar, tomatoes.", calories: "680", price: "$3.99", customizable: true },
  { code: "CINNABON_DELIGHTS_2", name: "Cinnabon Delights 2 Pack", category: "Breakfast", description: "Two warm Cinnabon-flavored pastries filled with cream cheese frosting.", calories: "160", price: "$1.49", customizable: false },
  { code: "CINNABON_DELIGHTS_12", name: "Cinnabon Delights 12 Pack", category: "Breakfast", description: "Twelve warm Cinnabon-flavored pastries filled with cream cheese frosting.", calories: "930", price: "$6.99", customizable: false },
  // Drinks
  { code: "DRINK_MOUNTAIN_DEW_BAJA_BLAST", name: "Mountain Dew Baja Blast", category: "Drinks", description: "Taco Bell's signature Mountain Dew flavor.", calories: "150", price: "$2.19", customizable: false },
  { code: "DRINK_FOUNTAIN", name: "Fountain Drink", category: "Drinks", description: "Choice of Pepsi, Sierra Mist, Dr Pepper, Lipton Brisk Iced Tea, and more.", calories: "0", price: "$1.99", customizable: false },
  { code: "DRINK_COFFEE", name: "Coffee", category: "Drinks", description: "Hot brewed coffee.", calories: "5", price: "$1.39", customizable: false },
  // Value Menu
  { code: "CHEESY_ROLL_UP", name: "Cheesy Roll Up", category: "Value Menu", description: "Cheddar, mozzarella, pepper jack inside a warm flour tortilla.", calories: "180", price: "$1.00", customizable: false },
  { code: "SPICY_TATER_TOTS", name: "Spicy Tater Tots", category: "Value Menu", description: "Golden crispy tater tots with a spicy seasoning.", calories: "230", price: "$1.00", customizable: false },
];

const CATEGORIES = [...new Set(MENU.map((i) => i.category))];

// ── Response Helpers ──────────────────────────────────────────────────────────

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResponse(message: string) {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

function sessionStatus() {
  return {
    loggedIn: session.isLoggedIn,
    storeId: session.storeId || null,
    storeName: session.storeName || null,
    storeAddress: session.storeAddress || null,
  };
}

// ── MCP Server ────────────────────────────────────────────────────────────────

function createMcpServer(): McpServer {
  const server = new McpServer({ name: "mcp-tacobell", version: "1.0.0" });

  // ── tacobell_status ──────────────────────────────────────────────────────────

  server.tool(
    "tacobell_status",
    "Check the current session status: whether you are logged in and which store is selected.",
    {},
    async () => ok(sessionStatus())
  );

  // ── tacobell_login ───────────────────────────────────────────────────────────

  server.tool(
    "tacobell_login",
    "Log in to your Taco Bell account. If email/password are omitted, the values from TB_EMAIL and TB_PASSWORD environment variables are used.",
    {
      email: z.string().email().optional().describe("Taco Bell account email. Defaults to TB_EMAIL env var."),
      password: z.string().optional().describe("Taco Bell account password. Defaults to TB_PASSWORD env var."),
    },
    async ({ email, password }) => {
      const user = email ?? TB_EMAIL;
      const pass = password ?? TB_PASSWORD;
      if (!user || !pass) {
        return errorResponse("Email and password are required. Provide them as arguments or set TB_EMAIL/TB_PASSWORD environment variables.");
      }
      try {
        await ensureCsrfToken();
        await tbPost("/j_spring_security_check", {
          j_username: user,
          j_password: pass,
          CSRFToken: session.csrfToken,
        });
        session.isLoggedIn = true;
        return ok({ success: true, message: "Logged in successfully.", session: sessionStatus() });
      } catch (e: any) {
        return errorResponse(`Login failed: ${e.message}. Note: Taco Bell may challenge automated logins — if you get repeated 403 errors, try logging in via the website first to clear CAPTCHA, then retry.`);
      }
    }
  );

  // ── tacobell_find_stores ─────────────────────────────────────────────────────

  server.tool(
    "tacobell_find_stores",
    "Find Taco Bell locations near a zip code, city, or address. Returns a list of stores with IDs, addresses, and hours. Use tacobell_set_store to select one for your order.",
    {
      query: z.string().describe("Zip code, city name, or full address to search near (e.g. '90210', 'Austin TX', '123 Main St, Denver CO')."),
      limit: z.number().int().min(1).max(20).optional().default(5).describe("Maximum number of results to return. Defaults to 5."),
    },
    async ({ query, limit }) => {
      try {
        // Geocode the text query to lat/long via OpenStreetMap Nominatim
        const geoUrl = new URL("https://nominatim.openstreetmap.org/search");
        geoUrl.searchParams.set("q", query);
        geoUrl.searchParams.set("format", "json");
        geoUrl.searchParams.set("limit", "1");
        const geoRes = await fetch(geoUrl.toString(), {
          headers: { "User-Agent": "mcp-tacobell/1.0" },
        });
        if (!geoRes.ok) throw new Error(`Geocoding failed: HTTP ${geoRes.status}`);
        const geoData = await geoRes.json();
        if (!geoData.length) return errorResponse(`Could not geocode "${query}" — try a zip code or "City, State".`);
        const { lat, lon } = geoData[0];

        // Fetch nearby Taco Bell stores
        const storeUrl = new URL(`${TB_BASE}/tacobellwebservices/v4/tacobell/stores`);
        storeUrl.searchParams.set("latitude", lat);
        storeUrl.searchParams.set("longitude", lon);
        const storeRes = await tbFetch(`/tacobellwebservices/v4/tacobell/stores`, {
          method: "GET",
          params: { latitude: lat, longitude: lon },
        });
        if (!storeRes.ok) throw new Error(`Store search failed: HTTP ${storeRes.status}`);
        const data = await storeRes.json();

        const rawStores: any[] = data.nearByStores ?? data.stores ?? (Array.isArray(data) ? data : []);
        if (!rawStores.length) return ok({ message: "No Taco Bell locations found near that location.", query });

        const stores = rawStores.slice(0, limit).map((s: any) => ({
          storeId: s.storeNumber ?? s.name ?? s.id,
          displayName: s.name ?? "Taco Bell",
          address: [s.address?.line1, s.address?.town ?? s.address?.city, s.address?.region?.isocode ?? s.address?.state]
            .filter(Boolean).join(", "),
          phone: s.address?.phone,
          distance: s.formattedDistance ?? s.distance,
          isOpen: s.openingHours?.currentlyOpen ?? s.isOpen,
          hours: s.openingHours?.weekDayOpeningList?.reduce((acc: any, d: any) => {
            acc[d.weekDay] = d.closed ? "Closed" : `${d.openingTime?.formattedHour} – ${d.closingTime?.formattedHour}`;
            return acc;
          }, {}),
        }));

        return ok({ count: stores.length, query, geocodedTo: { lat, lon }, stores });
      } catch (e: any) {
        return errorResponse(e.message);
      }
    }
  );

  // ── tacobell_set_store ───────────────────────────────────────────────────────

  server.tool(
    "tacobell_set_store",
    "Select a Taco Bell store for pickup. Use tacobell_find_stores first to get a store ID.",
    {
      store_id: z.string().describe("The store ID returned by tacobell_find_stores."),
      store_name: z.string().optional().describe("Human-friendly store name (for display purposes only)."),
      store_address: z.string().optional().describe("Store address (for display purposes only)."),
    },
    async ({ store_id, store_name, store_address }) => {
      try {
        await ensureCsrfToken();
        await tbPost("/pickup-location/pickupLocation", {
          storeId: store_id,
          CSRFToken: session.csrfToken,
        });
        session.storeId = store_id;
        session.storeName = store_name ?? store_id;
        session.storeAddress = store_address ?? "";
        return ok({ success: true, message: `Store set to ${session.storeName}.`, session: sessionStatus() });
      } catch (e: any) {
        return errorResponse(`Failed to set store: ${e.message}`);
      }
    }
  );

  // ── tacobell_get_menu ────────────────────────────────────────────────────────

  server.tool(
    "tacobell_get_menu",
    "Browse the Taco Bell menu. Optionally filter by category. Returns item names, descriptions, calories, prices, and product codes.",
    {
      category: z.enum(CATEGORIES as [string, ...string[]]).optional()
        .describe(`Filter by category. Options: ${CATEGORIES.join(", ")}.`),
      search: z.string().optional()
        .describe("Search term to filter items by name (case-insensitive)."),
    },
    async ({ category, search }) => {
      let items = MENU;
      if (category) items = items.filter((i) => i.category === category);
      if (search) {
        const q = search.toLowerCase();
        items = items.filter((i) => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q));
      }
      return ok({
        categories: CATEGORIES,
        count: items.length,
        items: items.map(({ code, name, category: cat, description, calories, price, customizable }) => ({
          code, name, category: cat, description, calories, price,
          note: customizable ? "Customizable (use tacobell_get_item_options for options)" : undefined,
        })),
      });
    }
  );

  // ── tacobell_get_item_options ────────────────────────────────────────────────

  server.tool(
    "tacobell_get_item_options",
    "Fetch the available customization options for a menu item (e.g. extra cheese, no onions, sauce choices). Use the product code from tacobell_get_menu.",
    {
      product_code: z.string().describe("Product code from tacobell_get_menu (e.g. 'CRUNCHY_TACO')."),
    },
    async ({ product_code }) => {
      try {
        await ensureCsrfToken();
        const data = await tbGet(`/p/${product_code}/customizationOverlay`);
        return ok({ product_code, options: data });
      } catch (e: any) {
        return errorResponse(`Could not load customization options for ${product_code}: ${e.message}`);
      }
    }
  );

  // ── tacobell_add_to_cart ─────────────────────────────────────────────────────

  server.tool(
    "tacobell_add_to_cart",
    "Add a menu item to your cart. Use tacobell_get_menu to find the product code, and tacobell_get_item_options to see available customizations.",
    {
      product_code: z.string().describe("Product code from tacobell_get_menu (e.g. 'CRUNCHY_TACO')."),
      quantity: z.number().int().min(1).max(10).optional().default(1).describe("Number of this item to add. Defaults to 1."),
      customizations: z.array(z.object({
        type: z.enum(["add", "remove", "modify"]).describe("Whether to add an ingredient, remove one, or swap it."),
        ingredient: z.string().describe("Ingredient name (e.g. 'sour cream', 'extra cheese', 'beef → chicken')."),
      })).optional().describe("List of customizations to apply to this item."),
    },
    async ({ product_code, quantity, customizations }) => {
      if (!session.storeId) {
        return errorResponse("No store selected. Use tacobell_find_stores then tacobell_set_store first.");
      }
      try {
        await ensureCsrfToken();

        let data: any;
        if (customizations && customizations.length > 0) {
          // Customized item endpoint
          const adds = customizations.filter((c) => c.type === "add").map((c) => c.ingredient);
          const removes = customizations.filter((c) => c.type === "remove").map((c) => c.ingredient);
          const modifies = customizations.filter((c) => c.type === "modify").map((c) => c.ingredient);
          data = await tbPost("/cart/add-composite", {
            productCode: product_code,
            qty: String(quantity),
            CSRFToken: session.csrfToken,
            ...(adds.length ? { adds: adds.join(",") } : {}),
            ...(removes.length ? { removes: removes.join(",") } : {}),
            ...(modifies.length ? { modifies: modifies.join(",") } : {}),
          });
        } else {
          // Standard item endpoint
          data = await tbPost("/cart/add", {
            productCode: product_code,
            qty: String(quantity),
            CSRFToken: session.csrfToken,
          });
        }

        const item = MENU.find((i) => i.code === product_code);
        return ok({
          success: true,
          added: { code: product_code, name: item?.name ?? product_code, quantity, customizations: customizations ?? [] },
          cart: data,
        });
      } catch (e: any) {
        return errorResponse(`Failed to add item: ${e.message}`);
      }
    }
  );

  // ── tacobell_view_cart ───────────────────────────────────────────────────────

  server.tool(
    "tacobell_view_cart",
    "View the current contents of your Taco Bell cart, including all items and the subtotal.",
    {},
    async () => {
      try {
        await ensureCsrfToken();
        const subtotal = await tbGet("/cart/miniCart/SUBTOTAL");
        const cartPage = await tbGet("/cart");

        return ok({
          store: sessionStatus(),
          subtotal,
          cart: cartPage,
        });
      } catch (e: any) {
        return errorResponse(`Failed to retrieve cart: ${e.message}`);
      }
    }
  );

  // ── tacobell_place_order ─────────────────────────────────────────────────────

  server.tool(
    "tacobell_place_order",
    "Submit your current cart as an order for pickup. You must be logged in and have a store selected. Payment will be charged to the saved payment method on your Taco Bell account.",
    {
      confirm: z.boolean().describe("Set to true to confirm that you want to place the order and be charged. This is a real order at a real Taco Bell."),
      tip_percent: z.number().min(0).max(100).optional().default(0).describe("Tip percentage to add (0–100). Defaults to 0."),
    },
    async ({ confirm, tip_percent }) => {
      if (!confirm) {
        return errorResponse("Order not placed. Set confirm: true to submit the order. This is a real order at a real Taco Bell and your saved payment method will be charged.");
      }
      if (!session.isLoggedIn) {
        return errorResponse("You must be logged in to place an order. Use tacobell_login first.");
      }
      if (!session.storeId) {
        return errorResponse("No store selected. Use tacobell_find_stores then tacobell_set_store first.");
      }
      try {
        await ensureCsrfToken();

        // Step 1: Proceed to checkout
        const checkout = await tbGet("/checkout");

        // Step 2: Place the order (submit the checkout form)
        // The endpoint and required fields may vary — this targets the standard
        // Hybris checkout submission path used by the community-documented API.
        const order = await tbPost("/checkout/placeOrder", {
          CSRFToken: session.csrfToken,
          ...(tip_percent ? { tipPercent: String(tip_percent) } : {}),
        });

        return ok({
          success: true,
          message: "Order placed! Head to your Taco Bell for pickup.",
          store: { id: session.storeId, name: session.storeName, address: session.storeAddress },
          order,
          checkoutPage: typeof checkout === "string" ? "(HTML checkout page received)" : checkout,
        });
      } catch (e: any) {
        return errorResponse(
          `Failed to place order: ${e.message}\n\n` +
          `If this keeps failing, Taco Bell's checkout may require additional browser-side steps. ` +
          `You can build your cart here and complete checkout at tacobell.com or in the Taco Bell app.`
        );
      }
    }
  );

  // ── tacobell_reorder ─────────────────────────────────────────────────────────

  server.tool(
    "tacobell_reorder",
    "Re-place a previous Taco Bell order by its order ID. Useful if you regularly order the same thing. Use tacobell_get_order_history to find order IDs.",
    {
      order_id: z.string().describe("The order ID to reorder (from tacobell_get_order_history)."),
      confirm: z.boolean().describe("Set to true to confirm the reorder. This is a real order and your payment method will be charged."),
    },
    async ({ order_id, confirm }) => {
      if (!confirm) {
        return errorResponse("Reorder not placed. Set confirm: true to submit.");
      }
      if (!session.isLoggedIn) {
        return errorResponse("You must be logged in. Use tacobell_login first.");
      }
      if (!session.storeId) {
        return errorResponse("No store selected. Use tacobell_find_stores then tacobell_set_store first.");
      }
      try {
        await ensureCsrfToken();
        const data = await tbPost(`/order/reorder/${order_id}`, { CSRFToken: session.csrfToken });
        return ok({ success: true, orderId: order_id, response: data });
      } catch (e: any) {
        return errorResponse(`Failed to reorder: ${e.message}`);
      }
    }
  );

  // ── tacobell_get_order_history ───────────────────────────────────────────────

  server.tool(
    "tacobell_get_order_history",
    "Retrieve your past Taco Bell orders. Useful for finding order IDs to use with tacobell_reorder.",
    {
      limit: z.number().int().min(1).max(50).optional().default(10).describe("Number of recent orders to retrieve. Defaults to 10."),
    },
    async ({ limit }) => {
      if (!session.isLoggedIn) {
        return errorResponse("You must be logged in. Use tacobell_login first.");
      }
      try {
        await ensureCsrfToken();
        const data = await tbGet("/account/orders", { pageSize: String(limit) });
        return ok({ orders: data });
      } catch (e: any) {
        return errorResponse(`Failed to retrieve order history: ${e.message}`);
      }
    }
  );

  return server;
}

// ── Express App & MCP Transport ───────────────────────────────────────────────

const app = express();
app.use(express.json());

// Simple bearer-token auth middleware
function authenticate(req: Request, res: Response, next: () => void): void {
  if (!OAUTH_CLIENT_SECRET) { next(); return; }
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token || token !== OAUTH_CLIENT_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// Health check
app.get("/health", (_req, res) => res.json({ status: "ok", session: sessionStatus() }));

// ── OAuth 2.0 ─────────────────────────────────────────────────────────────────

// In-memory store for authorization codes (expire after 60 seconds)
const authCodes = new Map<string, {
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  expiresAt: number;
}>();

// OAuth Authorization Server Metadata (RFC 8414)
app.get("/.well-known/oauth-authorization-server", (_req, res) => {
  const base = `https://${_req.headers.host}`;
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/oauth/token`,
    grant_types_supported: ["authorization_code", "client_credentials"],
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256", "plain"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
  });
});

// Authorization endpoint — auto-approves and redirects back with a code
app.get("/authorize", (req: Request, res: Response) => {
  const { response_type, client_id, redirect_uri, state, code_challenge, code_challenge_method } =
    req.query as Record<string, string>;

  if (response_type !== "code") {
    res.status(400).send("unsupported_response_type");
    return;
  }
  if (client_id !== OAUTH_CLIENT_ID) {
    res.status(401).send("Unknown client_id");
    return;
  }

  const code = crypto.randomBytes(16).toString("hex");
  authCodes.set(code, {
    redirectUri: redirect_uri,
    codeChallenge: code_challenge,
    codeChallengeMethod: code_challenge_method,
    expiresAt: Date.now() + 60_000,
  });

  const url = new URL(redirect_uri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  res.redirect(url.toString());
});

// Token endpoint — authorization_code and client_credentials grants
app.post("/oauth/token", express.urlencoded({ extended: false }), (req: Request, res: Response) => {
  if (!OAUTH_CLIENT_ID || !OAUTH_CLIENT_SECRET) {
    res.status(501).json({ error: "OAuth not configured on this server" });
    return;
  }

  const { grant_type, client_id, client_secret, code, code_verifier } = req.body;

  if (grant_type === "authorization_code") {
    const stored = authCodes.get(code);
    if (!stored || stored.expiresAt < Date.now()) {
      res.status(401).json({ error: "invalid_grant" });
      return;
    }

    // Verify PKCE if the authorization request included a code_challenge
    if (stored.codeChallenge) {
      if (!code_verifier) {
        res.status(401).json({ error: "invalid_grant", error_description: "code_verifier required" });
        return;
      }
      const method = stored.codeChallengeMethod ?? "plain";
      const derived = method === "S256"
        ? crypto.createHash("sha256").update(code_verifier).digest("base64url")
        : code_verifier;
      if (derived !== stored.codeChallenge) {
        res.status(401).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
        return;
      }
    }

    authCodes.delete(code);
    res.json({ access_token: OAUTH_CLIENT_SECRET, token_type: "Bearer", expires_in: 86400 });
    return;
  }

  if (grant_type === "client_credentials") {
    if (client_id !== OAUTH_CLIENT_ID || client_secret !== OAUTH_CLIENT_SECRET) {
      res.status(401).json({ error: "invalid_client" });
      return;
    }
    res.json({ access_token: OAUTH_CLIENT_SECRET, token_type: "Bearer", expires_in: 86400 });
    return;
  }

  res.status(400).json({ error: "unsupported_grant_type" });
});

// MCP endpoint — stateless: new server instance per request
async function handleMcp(req: Request, res: Response) {
  const mcpServer = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  res.on("finish", () => {
    transport.close();
    mcpServer.close();
  });

  await mcpServer.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

app.post("/mcp", authenticate, handleMcp);
app.get("/mcp", authenticate, handleMcp);
app.delete("/mcp", (_req, res) => res.status(405).json({ error: "Method not allowed" }));

app.listen(PORT, () => {
  console.log(`mcp-tacobell listening on port ${PORT}`);
  console.log(`  Store: ${session.storeId ? `${session.storeId} (${session.storeName})` : "not set — use tacobell_find_stores"}`);
  console.log(`  Auth:  ${OAUTH_CLIENT_SECRET ? "enabled" : "disabled (set OAUTH_CLIENT_SECRET to enable)"}`);
});
