# Till access: staff PINs, the lock screen and who may do what

User request 2026-11-24. **The rule: without a PIN the till is not shown.** Whoever works a till
signs in on it with their own PIN, everything they ring up carries their name, and nobody can
borrow someone else's rights through the till.

This document covers what the feature does, what it needs to work, the flows, and the loopholes
that were closed. Code references are given so each statement can be checked.

---

## 1. Features

| Feature | Where |
| --- | --- |
| **Staff PINs (admin)**: every HR employee who hasn't left is listed, whether or not they have a login, plus members who have a login but no employee record. The admin can **Generate** a random PIN, **Set PIN** to type one, or **Generate for N without a PIN**. New PINs are shown once, then stored hashed. | POS → Setup → *Staff PINs* (`apps/web/src/pages/pos/StaffPins.tsx`) |
| **Till lock screen**: the till shows only a PIN pad until someone signs in. | `TillLock` in `apps/web/src/pages/pos/restaurant/WaiterControl.tsx`, gate in `Till.tsx` |
| **Idle auto-lock**: 5 minutes with no tap, key or scroll signs the person out and the lock screen returns. | `useTillIdleLock` / `TILL_IDLE_LOCK_MS` in `apps/web/src/lib/pos-operator.ts` |
| **Sign out / Exit**: *Sign out* locks the till. *Leave the till* signs the person out, then leaves. | `WaiterControl`, `Till.tsx` |
| **Orders and tabs carry the person**: orders, tabs, voids and tab requests are recorded under the signed-in person, not under the device's login. | `X-Pos-Operator` header (`apps/web/src/api/client.ts`), `PosOperatorService.OperatorAsync` |
| **Waiter cash settlement**: per-waiter sales, tips and cash at the end of a shift. A shortage is charged to the waiter's employee account, with or without a login. | `PosService` waiter settlement |
| **Employees without a login**: a cook or waiter who never uses the back office still gets a PIN. The till identifies them by their HR employee record. | `PosOperatorService.OperatorIdOf` |
| **Server-side PIN rule**: once a company has issued any PIN, the API refuses till work that has no PIN sign-in. | `PosOperatorService.PinRequiredAsync` |
| **Manager actions go by the person**: returns, cancellations, voiding items the kitchen already has, and POS setup are allowed by the signed-in person's own rights, never the device's. | `PosOperatorService.MayApproveAsync` / `CanApproveAsync`, `CompanyAccessFilter.RefuseOperatorWithoutApproveAsync` |
| **Wrong-PIN lock**: 5 wrong PINs in a row from one device lock that device for 5 minutes. Sign-in is also rate limited. | `PosOperatorService.SignInAsync`, `PinSignIn` (`AuthRateLimit.Policy`) |
| **Sign-in tied to the PIN**: changing or removing a PIN ends every sign-in made with the old one. | `Claim.Stamp` in `PosOperatorService` |
| **Offline sales keep their waiter**: a sale rung up offline stores the waiter's sign-in and is credited to them when it syncs. | `PosOrderRequest.OperatorToken`, `Till.tsx` offline queue |

---

## 2. Requirements (what it needs to work)

### Setup, once per company
1. **POS module enabled** for the company.
2. **A store and a register** (POS → Setup).
3. **Staff in HR → Employees.** Anyone who will work a till needs an employee record (name; a login is optional). People who left (termination date in the past) are excluded automatically.
4. **PINs issued**: POS → Setup → *Staff PINs* → *Generate for N without a PIN*. Write the PINs down or hand them out right away, because they are shown only once.
   - A PIN is 4–8 digits, and no two people in a company may share one: the PIN alone identifies the person.
   - Generated PINs avoid weak patterns (`1111`, `1234`, `9876`).
5. **Every till and kitchen screen is connected as a device** (POS setup → *Till & kitchen devices*, §7), not logged in with a person's account.

### Restaurant extras
6. **Production centres** (Bar, Kitchen, Grill…) in POS → Setup, and **every menu item assigned to one**. Items without a centre never reach the kitchen screen and don't appear on the QR menu.
7. **Floors and tables** for the floor plan. Each table has a QR code for guests to order.

### Who can do what

| Action | Needs |
| --- | --- |
| Issue or change staff PINs, set up stores, registers, tables and menus | A login with **POS: Approve** (owner, accountant, or staff whose role grants it) |
| Open the till screen | The device login with **POS: Write**, **and** a staff PIN |
| Sell, open and edit tabs, send to kitchen, pre-bill, transfer, merge, charge to room, cash in/out, open or close the session, settle a waiter | A PIN sign-in on the till (once any PIN exists in the company) |
| Return or cancel a sale, void an item the kitchen already has | The **signed-in person** has POS: Approve (owner, administrator, accountant, or a role with POS: Approve). An employee with only a PIN never does. |
| Kitchen screen: bump and recall tickets | Device login only. The kitchen screen has no PIN. |
| QR menu: a guest orders from the table | Nothing (public link). Orders arrive as requests a waiter must accept on the till. |

---

## 3. Flows

### 3.1 Administrator issues PINs
1. POS → Setup → *Staff PINs*. All active employees and members are listed, each with a PIN badge (*No PIN* / *Set*).
2. *Generate for N without a PIN*, or per person *Generate* or *Set PIN* (typed twice).
3. A dialog shows **name → PIN** once. Hand the PINs out.
4. Changing a PIN later immediately signs that person out of every till.

### 3.2 A shift on the till
1. The till device is already logged in (its dedicated account) and opens `/pos/till/{register}`.
2. **Lock screen**: *Enter your PIN*. The person types their PIN and taps *Waiter sign-in*.
   - Wrong PIN: the field clears with an error. After 5 wrong PINs in a row, the device waits 5 minutes.
3. If no session is open, they open one with the opening float. Otherwise the floor plan or sale screen appears.
4. Everything they do is recorded under their name: tabs, orders, voids, cash movements.
5. **Hand-over**: *Sign out* → lock screen → the next person types their PIN.
6. **Walked away**: after 5 idle minutes the till locks by itself.
7. **Leave the till** signs the person out before going back to POS.

### 3.3 Manager action on someone else's till
1. The waiter taps *Sign out*.
2. The manager types **their own** PIN, does the return or void (with a reason), then signs out.
3. The waiter signs back in.

(An inline "manager approval" PIN box that doesn't sign the waiter out is a possible next step;
self-checkout already uses one for age checks, `AttendantPinDialog`.)

### 3.4 End of shift
1. A manager signs in and runs the waiter settlement: cash handed over per waiter. A shortage needs a reason and is charged to the waiter's employee account.
2. The session is closed with the counted drawer and posts its journal entry.

### 3.5 Offline
1. The network drops and a sale is queued on the device, **with the waiter's sign-in**.
2. When the network is back the queue syncs, and the sale is credited to the waiter who rang it up, not whoever is signed in at that moment.

---

## 4. Loopholes found and closed (2026-11-24)

| # | Loophole | How it could be abused | Fix | Test |
| --- | --- | --- | --- | --- |
| 1 | **The till opened without a PIN.** The till page ran on the device's login, and the PIN was optional. | Anyone at the device could sell, void and open the drawer as "the device". | Lock screen in front of every till profile (retail, restaurant, self-checkout, services). Idle auto-lock after 5 min. *Leave the till* signs out. | `Restaurant.test.tsx`: *signs a waiter in…*, *locks itself after five idle minutes…* |
| 2 | **The API didn't require a PIN.** Hiding the till in the browser is not enough. | Calling the API with the device's login (browser dev tools, a script) to post orders with no person behind them. | Once the company has any staff PIN, sessions, orders, cash movements, waiter settlement, every tab change and charge-to-room are refused with *"Sign in with your PIN on the till first."* | `PosTests.Till_NeedsAPin_AndManagerActionsGoByTheSignedInOperator` |
| 3 | **Manager checks used the device's rights.** If the till was logged in as the owner, *every* waiter had owner rights. | A waiter does returns or cancellations to pocket cash, or voids items the kitchen already made. | Returns, cancellations and kitchen voids check the **signed-in person**. POS setup endpoints refuse a signed-in waiter even on an owner-logged device. | same test (`ForbidResult` on a return by a PIN-only cook) |
| 4 | **PINs could be guessed.** 4 digits means 10,000 options, with unlimited tries. | Trying every PIN to sign in as the manager. | 5 wrong PINs in a row lock that device for 5 minutes, plus the per-address sign-in rate limit. | same test (`till-1` locked, `till-2` fine) |
| 5 | **Old sign-ins outlived a PIN change.** A sign-in lasted 12 h no matter what. | A dismissed employee's open sign-in keeps working after the admin changes their PIN. | Each sign-in carries a fingerprint of the PIN it was made with. A changed or removed PIN ends it at the next request. Leavers (past termination date) are refused too. | same test (old token → 403 after new PIN) |
| 6 | **Offline sales went to the wrong person.** Queued sales were sent with whoever was signed in at sync time. | Sales, tips and cash shortages credited to the wrong waiter. | The queued sale stores its waiter's sign-in (`operatorToken`), and the server uses it when the request carries no header. | same test (`CreatedOffline` + `OperatorToken`) |

Already in place before today and still true:
- PINs are stored hashed (ASP.NET `PasswordHasher`), never in plain text, and shown once on issue.
- No two people in a company can share a PIN.
- A sign-in only works for the company it was made in, and the header is only sent to that company's POS endpoints.
- A forged or garbled sign-in counts as no sign-in.

---

## 5. Known limits (not code-fixable, or deliberately left)

1. **The device's own login matters.** Solved by **till devices** (§7): a till connected as a device can't leave the till and kitchen screens. A till logged in with a person's login (old setups) still gives that person's access when someone leaves the till, so connect every till as a device.
2. **The PIN switches on when the first one is issued.** Until a company issues its first PIN, the API accepts till work on the device's login, as before (so existing shops don't stop mid-day). The web till requires a PIN from the start, so a company with no PINs sees the lock screen. Issue PINs before going live.
3. **Wrong-PIN lock is per API process and in memory.** Restarting the API clears it. The rate limit (30 sign-in/login requests per minute per address) still applies. With several API servers, each counts separately.
4. **Many tills behind one internet address** share that rate limit. That's fine for a restaurant, but worth knowing if 30+ sign-ins per minute ever happen.
5. **Offline sales older than 12 h** lose their waiter: the sign-in has expired by the time they sync, and the sale falls back to the device's login. This only affects outages longer than a shift.
6. **The kitchen screen and QR menu have no PIN** by design. The kitchen only bumps tickets, and guest QR orders wait for a waiter to accept them on the till.
7. **The self-checkout age check accepts any staff PIN**, not only managers'. It confirms the customer's age, nothing financial.

---

## 6. Technical reference

- **Operator id**: the employee's login id if they have one, otherwise the HR employee id (`OperatorIdOf`). Stored in `pos_pins.UserId` and the waiter columns on tabs, orders and settlements. No foreign keys, so no migration was needed.
- **Sign-in token**: a time-limited (12 h) data-protected `{CompanyId, UserId, Stamp}`, sent as `X-Pos-Operator` (or `operatorToken` in an offline order).
- **Endpoints**:
  - `GET pos/pins`: staff list.
  - `PUT pos/pins/{operatorId}`: issue a PIN (body `{ pin? }`; blank generates one).
  - `PUT pos/pins/me`: set your own PIN.
  - `POST pos/pins/sign-in`: `{ pin }` → `{ userId, name, token, expiresAt }`.
- **Errors (EN/SQ)**: `PosPinRequired`, `PosPinLocked`, `PosPinWrong`, `PosPinTaken`, `PosPinInvalid`, `PosStaffNotFound`, `PosVoidNeedsManager`.
- **Tests**:
  - Backend `PosTests`: `Till_NeedsAPin_AndManagerActionsGoByTheSignedInOperator`, `Administrator_IssuesRandomOrTypedPins_ForStaff`, `Waiters_SignInWithPins_TakeTips_AndSettleTheirCash`, `IsWeakPin_RejectsRepeatsAndRuns`.
  - Web: `StaffPins.test.tsx` and `Restaurant.test.tsx`. Till tests sign in through `src/test/posOperator.ts`.

---

## 7. Till & kitchen devices (user request 2026-11-24)

> "There should be access with the login that will show only the till and kitchen display so no
> user will be able to go in the app after the till/pos is closed."

### What it is
A **device** is a login for a screen, not a person:
- It has **no password**. It connects only through a link the administrator makes.
- It belongs to **one company** and has the built-in **Till device** role: **POS: Write, Items: Read, nothing else**. That covers parts search on the till; the account list (cash in/out), customer list and item categories are reference data any login reads.
- In the app it sees **only** the device home, the till, the kitchen display and the ticket scanner. Any other address leads back to the device home (`DeviceGuard`). The server refuses everything else by role regardless.
- It never appears under Users or Roles, can't be given a staff PIN, and its role can't be edited or assigned to a person.

### Managing devices (POS setup → *Till & kitchen devices*)

| Action | What happens |
| --- | --- |
| **Add device** (name, e.g. "Bar till") | Creates the device and shows its **connect link** as a QR code and an address with *Copy*. |
| Open the link on the screen | The screen is signed in as that device and opens the device home. The link is used up. |
| **New link** | For a replaced tablet, or to reconnect a disconnected device. The previous link stops working, and connecting with the new one signs out wherever the device was before. |
| **Rename** | Changes the name shown on the list and on the device. |
| **Disconnect** | The device is signed out at its next request and shows the login page. *New link* brings it back. |
| Status column | *Connected* (signed in), *Waiting to connect* (link not used yet), *Disconnected*. *Last seen* is updated about every 15 minutes while the screen is in use. |

Links last **24 hours** and work **once**. The link's address is the one the administrator is
using (`window.location.origin`), so make the link from an address the till can reach (the
server's network address, not `localhost`).

### On the device
1. **Device home**: the device name and company, the **tills** (registers), the **kitchen displays** (per store: all stations, or one station such as Kuzhina or Bari), and the **ticket scanner** if events are on.
2. Tapping one opens it, and the device remembers it: when the app is reopened (restart, power cut), it goes straight back to that screen. *Continue where this screen was* does the same by hand.
3. The till still needs a **staff PIN** (§2–3). *Leave the till* returns to the device home, never into Pako.
4. **Disconnect device** (top right) needs a **manager's PIN** (someone with POS: Approve). A waiter can't sign the till out and log in as someone else.
5. Manager work on a device: a manager signs in on the till with their PIN. POS manager actions (returns, kitchen voids, pharmacy payers, fuel setup, online channels on the till) then go by **the manager's rights** for as long as they are signed in. The device alone can't do them.

### Flow for a new restaurant
1. Admin: HR → employees; POS setup → *Staff PINs* → *Generate for N without a PIN*; hand out the PINs.
2. Admin: POS setup → *Till & kitchen devices* → *Add device* "Bar till" → scan the QR on the bar tablet. Repeat for "Kitchen screen".
3. Bar tablet: device home → *Bar* → lock screen → waiter's PIN → work.
4. Kitchen tablet: device home → *Kuzhina · Te Ura* → tickets arrive (no PIN on the kitchen screen).
5. End of day: the manager signs in on the till with their PIN, settles the waiters, and closes the session. The till returns to the lock screen. Nobody can get from it into the books.

### Technical
- `PosDeviceService` (`backend/Pako.Api/Services`): a device is an `AppUser` (`till-{id}@devices.pako.invalid`, random unknown password) with a `ClientStaff` membership on the company's `CompanyRole` with `BuiltInKey = "pos-device"`. **No migration**: existing tables only.
- Link code: a data-protected, 24 h `{CompanyId, UserId, Stamp}`. `Stamp` is the device user's security stamp, which pairing and every new link change, so a link works once and old links die.
- Endpoints:
  - `GET/POST pos/devices`, `PUT pos/devices/{id}`, `POST pos/devices/{id}/link`, `POST pos/devices/{id}/disconnect`: all POS: Approve.
  - `POST pos/devices/me/disconnect`: the device itself, with a manager's PIN sign-in.
  - `POST api/auth/device-connect {code}`: anonymous, rate limited, returns a normal sign-in with a 30-day refresh token renewed on use.
- `GET api/auth/me` returns `posDeviceCompanyId` / `posDeviceName` for a device. The web app uses them in `DeviceGuard` (`apps/web/src/components/DeviceGuard.tsx`, paths in `lib/posDevice.ts`).
- Disconnecting deactivates the membership (company endpoints refuse at once), changes the security stamp and revokes the refresh tokens.
- Tests:
  - Backend `PosTests.Devices_ConnectOnceWithTheirLink_AreTillOnly_AndOnlyAManagerDisconnectsThem`.
  - Web `src/pages/pos/device/Devices.test.tsx`.


## 8. Tills on the desktop edition (user request 2026-11-24: "yes build it, unlimited tills")

The desktop app keeps everything on one PC: Postgres and the API listen on 127.0.0.1 only, and every
`/api` call needs the launch cookie only the PAKO window has. For tills, that PC becomes the shop's
server: **one database, no sync**. Tablets are browsers on the shop network.

- **Setting**: Settings → *Tills on this network* → *Allow tills on this network* + port (default
  5300, fixed so links and bookmarks survive restarts). Off by default. Stored in the desktop
  `config.json` (`tillNetwork`, `tillPort`). Unlimited tills: the licence does not count them.
- **Apply** restarts only the API (inside `backupQueue.exclusive`, like a restore), now also bound
  to `http://0.0.0.0:<port>` with `Desktop__TillPort`. A failed restart puts the old API back; if
  that fails too PAKO stops like any API failure. A port taken at start-up does not stop PAKO: the
  tills stay off and Settings shows why.
- **Windows Firewall**: one UAC prompt adds rule *PAKO tills* for `Pako.Api.exe` (per program, so a
  new port needs no new prompt), private and domain profiles only, never public.
- **Sleep**: while tills are on, `powerSaveBlocker('prevent-app-suspension')` keeps the PC awake.
- **What the till port lets in** (`TillNetworkMiddleware`, after authentication):
  the web app's files; `auth/device-connect`, `auth/refresh`, `auth/logout`; every other `/api` and
  `/hubs` call only with a **connected device's** token (`PosDeviceService.DeviceOfAsync`, so a
  disconnect cuts the tablet off at once). Refused there: `auth/login` (nobody on the Wi-Fi signs
  in to the full ERP), `/api/desktop/*` (first-run setup, licence, recovery), `/uploads` (company
  logo and stamp stay on the PC), and any person's token. The PC window is unchanged.
- **Links**: in the desktop app the connect link and QR use this PC's network address
  (`useTillNetwork`, first private IPv4, real adapters before virtual ones). With tills off the link
  dialog says to turn them on instead of showing a 127.0.0.1 link a tablet can't open.
- **Plain http on the LAN**: browsers give no `crypto.randomUUID` outside https/localhost; the till
  uses it, so `lib/randomUuid.ts` fills it in at start-up.
- **Limits**: if the PC is off the tills stop (the till's offline queue covers short gaps only);
  a DHCP address change moves the till address, so give the PC a fixed address in the router;
  traffic on the shop network is plain http (as with every local desktop POS).
- Code: `apps/desktop/src/tillNetwork.ts` (+ test), `main.ts`, `config.ts`, `api.ts`;
  `backend/Pako.Api/Desktop/TillNetworkMiddleware.cs`, `LaunchSecretMiddleware.cs`,
  `DesktopOptions.TillPort`; tests `Pako.Tests/Desktop/TillNetworkTests.cs`; web
  `pages/settings/DesktopTillNetworkPanel.tsx`, `lib/tillNetwork.ts`, `PosDevices.tsx`.

## 9. Till PCs (desktop till mode)

User request 2026-11-24 ("yes build it, only the till"): the same installer makes a **main PC** or
a **till PC**. One database stays on the main PC; a till PC stores nothing.

- **First start** on a PC with no data asks *Main PC* or *Till* (`setup.html`, its own preload
  `setupPreload.cjs`, IPC refused from anything but the local file). The answer is
  `mode.json` in the app data folder. An install that already has a database stays the main PC
  without asking.
- **Finding the main PC**: the till port's `/healthz` answers `{ app: "pako", machine }`; the till
  PC probes every address of its /24 networks on port 5300 (48 at a time, 700 ms each) and lists
  the main PCs found by machine name, or takes a typed address (`192.168.1.10`, `kasa-pc:5400`).
- **Till runtime** (`startTill` in `main.ts`): no Postgres, API, backups, scheduler or licence. One
  maximised window (F11 full screen) on `<main PC>/device`; navigation and requests are locked to
  that origin; starts with Windows (`setLoginItemSettings`). A till that isn't connected lands on
  `/device/connect` (`tillRedirect`).
- **Connecting**: POS setup → Devices → Connect now also shows a **short code** (`K7M4-QP2X`,
  8 characters without 0/O/1/I) beside the link and QR. It is typed on the till PC's connect page
  (shown when there's no `?code=`). Stored hashed with the long code in `AspNetUserTokens`
  (provider `PakoDevice`, no migration); `device-connect` accepts either; it's spent with the link,
  replaced by a new link and removed on disconnect. `PosDeviceLinkResponse.PairCode` (additive).
- **Main PC off**: the till shows *Can't reach the main PC*, retries every 5 seconds and offers
  *Use another main PC*.
- Code: `apps/desktop/src/tillMode.ts` (+ test), `setup.html`, `setup.js`, `setupPreload.ts`;
  `PosDeviceService` (pair codes), `Program.cs` (`/healthz`); web `DeviceConnect.tsx`,
  `PosDevices.tsx`; tests `TillNetworkTests` (short code, new link, healthz), `Devices.test.tsx`.
- Not yet tried on real Windows PCs: the UAC firewall prompt, start at login, and discovery on a
  real shop network.
