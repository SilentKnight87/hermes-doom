#!/usr/bin/env bash
# Builds the Doom engine (doomgeneric, GPL-2.0) to plain JavaScript with Emscripten.
# Usage: engine/build.sh [path-to-doomgeneric-checkout]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${1:-$HERE/../build/doomgeneric}/doomgeneric"
OUT="$HERE/../dashboard/dist"
DOOMGENERIC_REV="$(git -C "$SRC" rev-parse HEAD 2>/dev/null || echo unknown)"
FILES="dummy am_map doomdef doomstat dstrings d_event d_items d_iwad d_loop d_main d_mode d_net f_finale f_wipe g_game hu_lib hu_stuff info i_cdmus i_endoom i_joystick i_scale i_sound i_system i_timer memio m_argv m_bbox m_cheat m_config m_controls m_fixed m_menu m_misc m_random p_ceilng p_doors p_enemy p_floor p_inter p_lights p_map p_maputl p_mobj p_plats p_pspr p_saveg p_setup p_sight p_spec p_switch p_telept p_tick p_user r_bsp r_data r_draw r_main r_plane r_segs r_sky r_things sha1 sounds statdump st_lib st_stuff s_sound tables v_video wi_stuff w_checksum w_file w_main w_wad z_zone w_file_stdc i_input i_video doomgeneric"
SOURCES=""
for f in $FILES; do SOURCES="$SOURCES $SRC/$f.c"; done
mkdir -p "$OUT"
emcc -O2 -w -I"$SRC" $SOURCES "$HERE/doomgeneric_hermes.c" \
  -sWASM=0 -sMODULARIZE=1 -sEXPORT_NAME=createDoomEngine -sENVIRONMENT=web \
  -sDYNAMIC_EXECUTION=0 -sALLOW_MEMORY_GROWTH=0 -sINITIAL_MEMORY=134217728 \
  -sWASMFS=1 -sFORCE_FILESYSTEM=1 -sEXPORTED_FUNCTIONS=_main,_hd_key -sEXPORTED_RUNTIME_METHODS=FS,HEAPU32,callMain \
  -sINVOKE_RUN=0 -sEXIT_RUNTIME=0 \
  -o "$OUT/doom-engine.js"
echo "built $OUT/doom-engine.js from doomgeneric $DOOMGENERIC_REV"
