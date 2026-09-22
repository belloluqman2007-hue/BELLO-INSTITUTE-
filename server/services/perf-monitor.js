"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — optional process performance monitor
   ----------------------------------------------------------------------------
   Enabled ONLY when PERF_MONITOR=1 (off by default; intended for staging and
   load tests). Measures, in-process:

     • event-loop lag (perf_hooks.monitorEventLoopDelay) — p50/p95/max over a
       rolling window; the number that shows whether any request handler is
       blocking the loop (sync fs, sync crypto, giant JSON, ...)
     • heap / RSS usage
     • process CPU % (delta of process.cpuUsage between samples)
     • database driver statistics (MySQL pool utilisation)

   It collects on a low-frequency timer (250 ms resolution for the lag
   histogram) and answers from in-memory counters: reading it is O(1) and can
   never itself distort the measurements. Nothing here is a cache of tenant
   data — only process-level numbers.
   ========================================================================== */
const { monitorEventLoopDelay } = require("perf_hooks");

let started = false;
let histogram = null;
let lastCpu = null;
let lastCpuAt = 0;
let cpuPercent = 0;
const MAX_SAMPLES = 256;
const rssSamples = [];
const heapSamples = [];

function start() {
  if (started) return;
  started = true;
  histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  lastCpu = process.cpuUsage();
  lastCpuAt = process.hrtime.bigint();
  // Sample memory + CPU once per second; keep a bounded window.
  const sampler = setInterval(() => {
    const mu = process.memoryUsage();
    rssSamples.push(mu.rss);
    heapSamples.push(mu.heapUsed);
    if (rssSamples.length > MAX_SAMPLES) rssSamples.shift();
    if (heapSamples.length > MAX_SAMPLES) heapSamples.shift();
    const cpu = process.cpuUsage();
    const now = process.hrtime.bigint();
    const wallMs = Number(now - lastCpuAt) / 1e6;
    if (wallMs > 0) {
      const totalUs = (cpu.user - lastCpu.user) + (cpu.system - lastCpu.system);
      cpuPercent = Math.round((totalUs / 1000 / wallMs) * 1000) / 10;
    }
    lastCpu = cpu;
    lastCpuAt = now;
  }, 1000);
  if (sampler.unref) sampler.unref();
}

/** Snapshot for the diagnostics endpoint. Safe to call even when disabled. */
async function snapshot(db) {
  const out = {
    enabled: started,
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
    cpuPercent,
    rssMb: Math.round((rssSamples.length ? rssSamples[rssSamples.length - 1] : process.memoryUsage().rss) / 1048576 * 10) / 10,
    heapUsedMb: Math.round((heapSamples.length ? heapSamples[heapSamples.length - 1] : process.memoryUsage().heapUsed) / 1048576 * 10) / 10,
    eventLoopLagMs: { p50: 0, p95: 0, p99: 0, max: 0 },
  };
  if (started && histogram) {
    const h = histogram;
    out.eventLoopLagMs = {
      p50: Math.round(h.percentile(50) / 1e6 * 100) / 100,
      p95: Math.round(h.percentile(95) / 1e6 * 100) / 100,
      p99: Math.round(h.percentile(99) / 1e6 * 100) / 100,
      max: Math.round(h.max / 1e6 * 100) / 100,
      mean: h.mean ? Math.round(h.mean / 1e6 * 100) / 100 : 0,
    };
  }
  try {
    if (db && db.stats) out.db = await db.stats();
  } catch (e) { /* diagnostics only */ }
  return out;
}

/** Manual reset of the lag histogram (used between test stages). */
function reset() {
  if (histogram) histogram.reset();
}

module.exports = { start, snapshot, reset };
