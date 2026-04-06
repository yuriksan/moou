<script setup lang="ts">
import { ref, computed } from 'vue';

const emit = defineEmits<{ close: [] }>();

const currentStep = ref(0);

const steps = [
  {
    title: 'Welcome to moou 🐄',
    body: 'moou helps product and engineering teams prioritise work by linking outcomes to their motivations — customer demands, tech debt, compliance, and more.',
  },
  {
    title: 'Timeline',
    body: 'The Timeline is your default view. Outcomes are grouped by milestone (releases, deadlines, reviews). The backlog sidebar shows unplanned work. Click any outcome to see its details.',
  },
  {
    title: 'Outcomes',
    body: 'Outcomes are what you want to achieve — features, improvements, migrations. They\'re ranked by priority score, computed from their linked motivations. Create one with "+ Outcome".',
  },
  {
    title: 'Motivations',
    body: 'Motivations are the reasons behind outcomes — a customer need, a compliance deadline, tech debt causing incidents. Each type has its own attributes and scoring formula. A single motivation can be shared across multiple outcomes.',
  },
  {
    title: 'Scoring',
    body: 'Priority is automatic. Each motivation computes a score from its attributes (revenue × urgency × confidence). An outcome\'s score is the sum of its linked motivations minus an effort penalty. Scores update as dates approach.',
  },
  {
    title: 'Date Mismatches',
    body: 'Red and amber dots warn when a motivation\'s target date is before the outcome\'s milestone date. Red = >90 days gap (critical), amber = 1-89 days (warning). This helps catch scheduling conflicts.',
  },
  {
    title: 'Export & Import',
    body: 'Export the timeline as Excel or Markdown from the Timeline header. Edit the spreadsheet and import it back — moou detects changes and lets you selectively apply them.',
  },
  {
    title: 'You\'re ready!',
    body: 'Start by creating an outcome, then attach motivations to see the scoring in action. Click the ? button in the header anytime to see this guide again.',
  },
];

const step = computed(() => steps[currentStep.value]!);
const isLast = computed(() => currentStep.value === steps.length - 1);
const isFirst = computed(() => currentStep.value === 0);

function next() {
  if (isLast.value) { emit('close'); return; }
  currentStep.value++;
}

function prev() {
  if (!isFirst.value) currentStep.value--;
}
</script>

<template>
  <div class="walkthrough-overlay" @click.self="emit('close')">
    <div class="walkthrough-card">
      <div class="wt-progress">
        <span
          v-for="(_, i) in steps" :key="i"
          :class="['wt-dot', { active: i === currentStep, done: i < currentStep }]"
        ></span>
      </div>

      <h2 class="wt-title font-display">{{ step.title }}</h2>
      <p class="wt-body">{{ step.body }}</p>

      <div class="wt-actions">
        <button v-if="!isFirst" class="btn btn-sm" @click="prev">Back</button>
        <span class="wt-step-count font-mono">{{ currentStep + 1 }}/{{ steps.length }}</span>
        <button class="btn btn-sm btn-primary" @click="next">
          {{ isLast ? 'Get Started' : 'Next' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.walkthrough-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 200ms ease;
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
.walkthrough-card {
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 32px rgba(0,0,0,0.12);
  padding: 28px 32px;
  max-width: 480px;
  width: 90%;
  animation: slideUp 250ms cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes slideUp {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.wt-progress {
  display: flex;
  gap: 4px;
  margin-bottom: 20px;
}
.wt-dot {
  width: 24px;
  height: 3px;
  border-radius: 2px;
  background: var(--bg-3);
  transition: background 200ms;
}
.wt-dot.active { background: var(--accent); }
.wt-dot.done { background: var(--teal); }

.wt-title {
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 10px;
}
.wt-body {
  font-size: 14px;
  color: var(--text-1);
  line-height: 1.6;
  margin-bottom: 20px;
}

.wt-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.wt-step-count {
  font-size: 11px;
  color: var(--text-3);
  margin-left: auto;
  margin-right: 8px;
}
</style>
