#include "doomgeneric.h"

#include <emscripten.h>
#include <stdint.h>

#define KEY_QUEUE_SIZE 64

static unsigned short key_queue[KEY_QUEUE_SIZE];
static unsigned int key_read;
static unsigned int key_write;

EM_JS(void, hd_present, (const uint32_t *pixels, int width, int height), {
  Module.onFrame(pixels, width, height);
});

EM_JS(void, hd_title, (const char *title), {
  if (Module.onTitle) Module.onTitle(UTF8ToString(title));
});

EMSCRIPTEN_KEEPALIVE void hd_key(int pressed, int key)
{
  key_queue[key_write] = (unsigned short)(((pressed ? 1 : 0) << 8) | (key & 0xff));
  key_write = (key_write + 1) % KEY_QUEUE_SIZE;
}

void DG_Init(void) {}

void DG_DrawFrame(void)
{
  hd_present(DG_ScreenBuffer, DOOMGENERIC_RESX, DOOMGENERIC_RESY);
}

void DG_SleepMs(uint32_t ms) { (void)ms; }

uint32_t DG_GetTicksMs(void)
{
  return (uint32_t)emscripten_get_now();
}

int DG_GetKey(int *pressed, unsigned char *key)
{
  if (key_read == key_write) return 0;
  unsigned short data = key_queue[key_read];
  key_read = (key_read + 1) % KEY_QUEUE_SIZE;
  *pressed = data >> 8;
  *key = data & 0xff;
  return 1;
}

void DG_SetWindowTitle(const char *title)
{
  hd_title(title);
}

static void tick(void)
{
  doomgeneric_Tick();
}

int main(int argc, char **argv)
{
  doomgeneric_Create(argc, argv);
  emscripten_set_main_loop(tick, 0, 0);
  return 0;
}
