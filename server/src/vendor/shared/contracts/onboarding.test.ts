import { describe, it, expect } from 'vitest';
import {
  OnboardingSectionKind,
  GenerateOnboardingBody,
  StrictOnboardingOutput,
  SECTION_ORDER,
} from './onboarding.js';

describe('OnboardingSectionKind', () => {
  it('accepts all 5 valid kinds', () => {
    for (const kind of SECTION_ORDER) {
      expect(OnboardingSectionKind.safeParse(kind).success).toBe(true);
    }
  });

  it('rejects invalid strings', () => {
    expect(OnboardingSectionKind.safeParse('routes_and_apis').success).toBe(false);
    expect(OnboardingSectionKind.safeParse('overview').success).toBe(false);
    expect(OnboardingSectionKind.safeParse('').success).toBe(false);
    expect(OnboardingSectionKind.safeParse(123).success).toBe(false);
  });
});

describe('GenerateOnboardingBody', () => {
  it('accepts valid language codes', () => {
    expect(GenerateOnboardingBody.safeParse({ language: 'en' }).success).toBe(true);
    expect(GenerateOnboardingBody.safeParse({ language: 'uk' }).success).toBe(true);
    expect(GenerateOnboardingBody.safeParse({ language: 'fr' }).success).toBe(true);
    expect(GenerateOnboardingBody.safeParse({ language: 'zh' }).success).toBe(true);
    expect(GenerateOnboardingBody.safeParse({ language: 'ptBR' }).success).toBe(true);
  });

  it('accepts empty body (language is optional)', () => {
    expect(GenerateOnboardingBody.safeParse({}).success).toBe(true);
    expect(GenerateOnboardingBody.safeParse({ language: undefined }).success).toBe(true);
  });

  it('rejects language values that are too long or contain non-alpha chars', () => {
    expect(GenerateOnboardingBody.safeParse({ language: 'toolong123' }).success).toBe(false);
    expect(GenerateOnboardingBody.safeParse({ language: '1!' }).success).toBe(false);
    expect(GenerateOnboardingBody.safeParse({ language: 'e' }).success).toBe(false);
    expect(GenerateOnboardingBody.safeParse({ language: 'english_' }).success).toBe(false);
  });
});

describe('StrictOnboardingOutput', () => {
  const makeSection = (kind: string) => ({
    kind,
    title: `Title for ${kind}`,
    body: 'Some body text',
    diagram: null,
    links: [],
  });

  it('accepts exactly 5 sections with valid kinds', () => {
    const result = StrictOnboardingOutput.safeParse({
      sections: SECTION_ORDER.map(makeSection),
    });
    expect(result.success).toBe(true);
  });

  it('rejects fewer than 5 sections', () => {
    const result = StrictOnboardingOutput.safeParse({
      sections: SECTION_ORDER.slice(0, 3).map(makeSection),
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 5 sections', () => {
    const result = StrictOnboardingOutput.safeParse({
      sections: [...SECTION_ORDER, 'architecture'].map(makeSection),
    });
    expect(result.success).toBe(false);
  });

  it('allows diagram as string for architecture section', () => {
    const sections = SECTION_ORDER.map((k) =>
      k === 'architecture'
        ? { ...makeSection(k), diagram: 'flowchart LR\n  A --> B' }
        : makeSection(k),
    );
    const result = StrictOnboardingOutput.safeParse({ sections });
    expect(result.success).toBe(true);
  });
});
