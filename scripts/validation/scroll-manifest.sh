#!/bin/sh
# The one definition of the generated device sources of feature 007
# (contracts/maestro-polish.md › Fixtures, Principle III).
#
# Sourced by device-fixtures.sh, which creates the files:
#
#   scroll_name <i>, scroll_size <i>, scroll_mtime <i>   i in 0…SCROLL_COUNT-1
#   narrow_name <i>, narrow_size <i>, narrow_mtime <i>   i in 0…NARROW_COUNT-1
#
# Run as `scroll-manifest.sh print`, it prints KEY=value lines with the values
# the polish/ flows expect (the first file of each sort and of the bands the
# scrollbar flows drag to). android-flow.sh passes each line to Maestro as an
# -e variable, so no flow restates a name or a size.
#
# Everything is a pure function of the index: no randomness, no clock.
#
# SyncScopeE2E/Scroll (5,000 files):
#   - names: an initial, `img-`, the four-digit index and `.png`. The initial
#     cycles through `1` and `_` (the `#` band), `a`…`z` and `é`; every third
#     file has an upper-case initial (so `É` appears too).
#   - sizes: a permutation of 5,000 distinct values from 2,000 B to 4,000,000 B.
#   - mtimes: 30 calendar months, January 2023 to June 2025. Each file lies
#     between day 2 and day 27 of its month (UTC), so no file is near a month
#     boundary in any time zone and the month bands do not depend on the
#     emulator's zone.
# SyncScopeE2E/Narrow (200 files): sizes from 3,000,000 B to 4,999,950 B in
#   steps of 10,050 B, mtimes within 21 days (March 2025).
#
# Name order follows research R2 (SortName: NFKD, accents removed, lower case,
# prefix 0 for the `#` band and 1 for a letter). The names only use initials
# whose folded form this script knows, so the sort key is computed here
# without an external Unicode tool; the script-contract test recomputes it
# with String.prototype.normalize('NFKD').
set -eu

SCROLL_COUNT=5000
NARROW_COUNT=200
# 2023-01-01T00:00:00Z: the first Scroll month.
SCROLL_FIRST_YEAR=2023
SCROLL_MONTHS=30
# 2025-03-01T00:00:00Z plus two days: the first Narrow mtime.
NARROW_BASE=1740960000

# _days_from_civil <year> <month> <day>: days since 1970-01-01 (proleptic
# Gregorian, H. Hinnant's algorithm), in _days.
_days_from_civil() {
  _y=$(($1 - ($2 <= 2)))
  _era=$((_y / 400))
  _yoe=$((_y - _era * 400))
  _doy=$(((153 * ($2 + ($2 > 2 ? -3 : 9)) + 2) / 5 + $3 - 1))
  _doe=$((_yoe * 365 + _yoe / 4 - _yoe / 100 + _doy))
  _days=$((_era * 146097 + _doe - 719468))
}

# _scroll <i>: sets _name, _key (the R2 sort name), _size, _mtime and _month
# (the MONTH band label, MM.YYYY) of Scroll file <i>. Runs without a subshell,
# so print can walk all 5,000 files quickly.
_scroll() {
  _i=$1
  _k=$((_i % 29))
  case "$_k" in
    0) _lo=1; _up=1; _fold=1 ;;
    1) _lo=_; _up=_; _fold=_ ;;
    2) _lo=a; _up=A ;; 3) _lo=b; _up=B ;; 4) _lo=c; _up=C ;;
    5) _lo=d; _up=D ;; 6) _lo=e; _up=E ;; 7) _lo=f; _up=F ;;
    8) _lo=g; _up=G ;; 9) _lo=h; _up=H ;; 10) _lo=i; _up=I ;;
    11) _lo=j; _up=J ;; 12) _lo=k; _up=K ;; 13) _lo=l; _up=L ;;
    14) _lo=m; _up=M ;; 15) _lo=n; _up=N ;; 16) _lo=o; _up=O ;;
    17) _lo=p; _up=P ;; 18) _lo=q; _up=Q ;; 19) _lo=r; _up=R ;;
    20) _lo=s; _up=S ;; 21) _lo=t; _up=T ;; 22) _lo=u; _up=U ;;
    23) _lo=v; _up=V ;; 24) _lo=w; _up=W ;; 25) _lo=x; _up=X ;;
    26) _lo=y; _up=Y ;; 27) _lo=z; _up=Z ;;
    *) _lo=é; _up=É; _fold=e ;;
  esac
  case "$_k" in 0 | 1 | 28) ;; *) _fold=$_lo ;; esac
  if [ $((_i % 3)) -eq 0 ]; then _initial=$_up; else _initial=$_lo; fi
  _n=$((_i + 10000))
  _stem="img-${_n#1}.png"
  _name="$_initial$_stem"
  case "$_k" in 0 | 1) _key="0$_fold$_stem" ;; *) _key="1$_fold$_stem" ;; esac

  _size=$((2000 + ((_i * 2971 + 1234) % SCROLL_COUNT) * 3998000 / (SCROLL_COUNT - 1)))

  # A second permutation of the index, so the date order differs from the
  # name and size orders.
  _j=$(((_i * 1777 + 911) % SCROLL_COUNT))
  _m=$((_j % SCROLL_MONTHS))
  _year=$((SCROLL_FIRST_YEAR + _m / 12))
  _mon=$((_m % 12 + 1))
  _days_from_civil "$_year" "$_mon" 2
  _mtime=$((_days * 86400 + (_j / SCROLL_MONTHS) * 12934))
  _mm=$((_mon + 100))
  _month="${_mm#1}.$_year"
}

# _narrow <i>: sets _name, _key, _size and _mtime of Narrow file <i>.
_narrow() {
  _n=$(($1 + 1000))
  _name="narrow-${_n#1}.png"
  _key="1$_name"
  _size=$((3000000 + ($1 * 37 % NARROW_COUNT) * 10050))
  _mtime=$((NARROW_BASE + ($1 * 53 % NARROW_COUNT) * 9000))
}

_check_index() {
  case "$1" in
    '' | *[!0-9]*) printf 'Index must be a whole number: %s\n' "$1" >&2; return 64 ;;
  esac
  if [ "$1" -ge "$2" ]; then
    printf 'Index out of range: %s\n' "$1" >&2
    return 64
  fi
}

scroll_name() { _check_index "$1" "$SCROLL_COUNT" && _scroll "$1" && printf '%s\n' "$_name"; }
scroll_size() { _check_index "$1" "$SCROLL_COUNT" && _scroll "$1" && printf '%s\n' "$_size"; }
scroll_mtime() { _check_index "$1" "$SCROLL_COUNT" && _scroll "$1" && printf '%s\n' "$_mtime"; }
narrow_name() { _check_index "$1" "$NARROW_COUNT" && _narrow "$1" && printf '%s\n' "$_name"; }
narrow_size() { _check_index "$1" "$NARROW_COUNT" && _narrow "$1" && printf '%s\n' "$_size"; }
narrow_mtime() { _check_index "$1" "$NARROW_COUNT" && _narrow "$1" && printf '%s\n' "$_mtime"; }

# scroll_manifest_print: the expected values, one KEY=value line each.
#   FIRST_<SORT>        the first Scroll file under each of the six sorts
#   LARGEST_NAME        the largest file over Scroll and Narrow together
#   BAND_MONTH_LABEL    the month band (MM.YYYY) at three quarters of the
#                       Scroll track in TIME_DESC order
#   BAND_MONTH_FIRST    that band's first file in TIME_DESC order
#   BAND_LETTER_M_FIRST the first file of the `m` band in NAME_ASC order
scroll_manifest_print() {
  _tab=$(printf '\t')
  _dir=$(mktemp -d)
  # shellcheck disable=SC2064
  trap "rm -rf '$_dir'" EXIT
  _i=0
  while [ "$_i" -lt "$SCROLL_COUNT" ]; do
    _scroll "$_i"
    printf '%s\t%s\t%s\t%s\t%s\n' "$_key" "$_name" "$_size" "$_mtime" "$_month"
    _i=$((_i + 1))
  done >"$_dir/scroll"
  _i=0
  while [ "$_i" -lt "$NARROW_COUNT" ]; do
    _narrow "$_i"
    printf '%s\t%s\t%s\t%s\t-\n' "$_key" "$_name" "$_size" "$_mtime"
    _i=$((_i + 1))
  done >"$_dir/narrow"

  LC_ALL=C sort -t "$_tab" -k1,1 "$_dir/scroll" >"$_dir/name"
  LC_ALL=C sort -t "$_tab" -k4,4n "$_dir/scroll" >"$_dir/time"
  LC_ALL=C sort -t "$_tab" -k3,3n "$_dir/scroll" >"$_dir/size"
  _band_month=$(sed -n "$((SCROLL_COUNT / 4))p" "$_dir/time" | cut -f5)

  printf 'SCROLL_COUNT=%s\n' "$SCROLL_COUNT"
  printf 'NARROW_COUNT=%s\n' "$NARROW_COUNT"
  printf 'FIRST_NAME_ASC=%s\n' "$(head -n 1 "$_dir/name" | cut -f2)"
  printf 'FIRST_NAME_DESC=%s\n' "$(tail -n 1 "$_dir/name" | cut -f2)"
  printf 'FIRST_TIME_DESC=%s\n' "$(tail -n 1 "$_dir/time" | cut -f2)"
  printf 'FIRST_TIME_ASC=%s\n' "$(head -n 1 "$_dir/time" | cut -f2)"
  printf 'FIRST_SIZE_DESC=%s\n' "$(tail -n 1 "$_dir/size" | cut -f2)"
  printf 'FIRST_SIZE_ASC=%s\n' "$(head -n 1 "$_dir/size" | cut -f2)"
  printf 'LARGEST_NAME=%s\n' \
    "$(LC_ALL=C sort -t "$_tab" -k3,3n "$_dir/scroll" "$_dir/narrow" | tail -n 1 | cut -f2)"
  printf 'BAND_MONTH_LABEL=%s\n' "$_band_month"
  printf 'BAND_MONTH_FIRST=%s\n' \
    "$(awk -F "$_tab" -v m="$_band_month" '$5 == m { name = $2 } END { print name }' "$_dir/time")"
  printf 'BAND_LETTER_M_FIRST=%s\n' \
    "$(awk -F "$_tab" 'substr($1, 1, 2) == "1m" { print $2; exit }' "$_dir/name")"

  rm -rf "$_dir"
  trap - EXIT
}

case "${0##*/}" in
  scroll-manifest.sh)
    case "${1:-}" in
      print) scroll_manifest_print ;;
      *)
        printf '%s\n' "Usage: scroll-manifest.sh print (or source it for the scroll_* and narrow_* functions)." >&2
        exit 64
        ;;
    esac
    ;;
esac
