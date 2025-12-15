# Sport Testing Checklist

Track real-world testing for each sport's scraping functionality.

## NHL (Hockey) ✅ Primary Sport - Config Verified

### Config Status: ✅ Verified against real samples

**Skater Stats Verified:**
- pts, goal, ast, sog, blks, hits, +/-, pim, toi, gva, tka, fo%

**Goalie Stats Verified:**
- sv, sv%, gaa, so, gp, w, l, otl

**Periods:** P1, P2, P3, OT, SO ✓
**Time formats:** :55 (seconds), 1:35, 8:22 (MM:SS) ✓
**Score format:** 0-2, 3-2 ✓

### Testing Checklist
- [ ] Draft modal scraping
  - [ ] Player names captured
  - [ ] Boost multipliers parsed
  - [ ] Slot count correct
- [x] Profile Feed tab - Config verified
  - [x] FPS values scraped
  - [x] Skater stats: G, A, SOG, BLK, HIT, +/-, PIM, TOI, GVA, TKA, FO%
  - [x] Goalie stats: SV, SV%, GAA, SO, GP
  - [ ] Opponent & result parsed


---

## NBA (Basketball)
- [ ] Draft modal scraping
- [ ] Profile Feed tab
  - [ ] Stats: PTS, REB, AST, STL, BLK, 3PM


## NFL (Football)
- [ ] Draft modal scraping
- [ ] Profile Feed tab
  - [ ] Stats: PASS YD, RUSH YD, TD, REC


## MLB (Baseball)
- [ ] Draft modal scraping
- [ ] Profile Feed tab
  - [ ] Stats: H, HR, RBI, R, SB


## CFB (College Football)
> Uses NFL config - test same stats

- [ ] Draft modal scraping
- [ ] Profile Feed scraping

## CBB (College Basketball)
> Uses NBA config - test same stats

- [ ] Draft modal scraping
- [ ] Profile Feed scraping

## WNBA
> Uses NBA config

- [ ] Draft modal scraping
- [ ] Profile Feed scraping

## FC (Soccer)
- [ ] Draft modal scraping
- [ ] Profile Feed scraping (if available)
  - [ ] Stats: Goals, Assists, Shots
  - [ ] Periods (H1, H2)

---

## How to Test
1. Open a draft modal for the sport
2. Click "Capture" - verify player data is correct
3. Use "Ask AI" with profile scraping - verify stats are extracted
4. Check Debug tab for raw data if issues arise

## Notes
- NHL config verified with real samples (Dec 14, 2025)
- Skater profile: Matt Boldy (Wild)
- Goalie profile: Thatcher Demko, Jeremy Swayman
