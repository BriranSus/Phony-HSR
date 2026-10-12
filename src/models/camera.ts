import { z } from 'zod';
import { IdSchema, TextSchema } from './common';

/**
 * Phase 3 camera data: exploration tuning, blend curves, shake profiles and shot presets for the
 * combat / skill / ultimate / boss / dialogue / cinematic modes. Accessibility settings (sensitivity,
 * invert Y, auto-recenter, shake intensity, FOV) live in the engine config and are shared with the
 * future settings screen.
 */
export const CAMERA_MODES = ['exploration', 'combat', 'skill', 'ultimate', 'boss', 'dialogue', 'cinematic'] as const;
export const CameraModeSchema = z.enum(CAMERA_MODES);
export type CameraModeId = z.infer<typeof CameraModeSchema>;

export const EASINGS = ['linear', 'easeInQuad', 'easeOutQuad', 'easeInOutQuad', 'easeInOutCubic', 'easeOutCubic', 'easeInOutSine', 'easeOutBack'] as const;
export const EasingSchema = z.enum(EASINGS);
export type EasingId = z.infer<typeof EasingSchema>;

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

/** A blend between two camera outputs; `cut` switches instantly. */
export const BlendSchema = z.union([z.literal('cut'), z.object({ duration: z.number().positive(), ease: EasingSchema }).strict()]);
export type Blend = z.infer<typeof BlendSchema>;

export const ShakeProfileSchema = z
  .object({
    /** Trauma added when the profile fires (0..1; shake strength is trauma^2). */
    trauma: z.number().min(0).max(1),
    /** Trauma lost per second. */
    decay: z.number().positive(),
    /** Max positional offset (m) and roll (rad) at full trauma. */
    maxOffset: z.number().min(0),
    maxRoll: z.number().min(0),
    /** Noise frequency (Hz). */
    frequency: z.number().positive(),
  })
  .strict();
export type ShakeProfile = z.infer<typeof ShakeProfileSchema>;

export const CameraRulesSchema = z
  .object({
    id: IdSchema,
    exploration: z
      .object({
        /** Zoom (orbit distance) range and default (m), wheel step factor and zoom smoothing (1/s). */
        distance: z.object({ min: z.number().positive(), max: z.number().positive(), default: z.number().positive(), wheelStep: z.number().positive(), smoothing: z.number().positive() }).strict(),
        /** Pitch clamps and default (rad, positive looks down on the player). */
        pitch: z.object({ min: z.number(), max: z.number(), default: z.number() }).strict(),
        /** Focus height above the feet (m) and shoulder offset to the right (m). */
        focusHeight: z.number(),
        shoulderOffset: z.number(),
        /** Look-ahead along the player's velocity (s of travel) and its smoothing (1/s). */
        lookAhead: z.number().min(0),
        lookAheadSmoothing: z.number().positive(),
        /** Focus follow smoothing (1/s). */
        followSmoothing: z.number().positive(),
        /** Keyboard / stick rotation speed (rad/s) and mouse radians per pixel at sensitivity 1. */
        rotateSpeed: z.number().positive(),
        mouseRadiansPerPixel: z.number().positive(),
        /** Auto-recenter behind the player while moving, after `delay` s without camera input. */
        recenter: z.object({ delay: z.number().min(0), speed: z.number().positive(), minPlayerSpeed: z.number().min(0) }).strict(),
        /** Collision: probe sphere radius (m), closest allowed distance (m), ease-out speed (m/s). */
        collision: z.object({ radius: z.number().positive(), minDistance: z.number().positive(), recoverSpeed: z.number().positive() }).strict(),
      })
      .strict()
      .refine((e) => e.distance.min <= e.distance.default && e.distance.default <= e.distance.max, 'default distance must lie in [min, max]')
      .refine((e) => e.pitch.min <= e.pitch.default && e.pitch.default <= e.pitch.max, 'default pitch must lie in [min, max]'),
    /** Default blend into each mode. */
    blends: z.record(CameraModeSchema, BlendSchema),
    /** Priority of each mode in the director stack (higher wins). */
    priorities: z.record(CameraModeSchema, z.number().int()),
    shakeProfiles: z.record(IdSchema, ShakeProfileSchema),
    /** Letterbox bar height as a fraction of the viewport height. */
    letterboxHeight: z.number().min(0).max(0.3),
  })
  .strict();
export type CameraRules = z.infer<typeof CameraRulesSchema>;

/**
 * An anchor a shot frames: a named unit (resolved by the game: "player", an enemy, an NPC), a fixed
 * world point, or the centroid of several units. Offsets are in the anchor's local frame
 * (x right, y up, z forward along the anchor's facing).
 */
export const AnchorSchema = z.union([
  z.object({ unit: z.string().min(1), offset: Vec3.default([0, 0, 0]) }).strict(),
  z.object({ point: Vec3 }).strict(),
  z.object({ centroid: z.array(z.string().min(1)).min(1), offset: Vec3.default([0, 0, 0]) }).strict(),
  /** Unit-local frame whose forward points from `unit` toward `toward` (over-the-shoulder shots). */
  z.object({ unit: z.string().min(1), toward: z.string().min(1), offset: Vec3.default([0, 0, 0]) }).strict(),
]);
export type Anchor = z.infer<typeof AnchorSchema>;

/** A camera keyframe: where the camera is, what it looks at and its FOV at time `t` (s). */
export const ShotKeySchema = z
  .object({
    t: z.number().min(0),
    position: AnchorSchema,
    lookAt: AnchorSchema,
    fov: z.number().min(10).max(120),
    ease: EasingSchema.default('easeInOutSine'),
  })
  .strict();
export type ShotKey = z.infer<typeof ShotKeySchema>;

export const CameraShotSchema = z
  .object({
    id: IdSchema,
    name: TextSchema,
    mode: CameraModeSchema.exclude(['exploration']),
    description: TextSchema,
    /** One key = a static framing for `duration`; several keys = a keyframed path (cinematic). */
    keys: z.array(ShotKeySchema).min(1),
    duration: z.number().positive(),
    /** Catmull-Rom spline through the key positions instead of straight segments. */
    spline: z.boolean().default(false),
    blendIn: BlendSchema.optional(),
    blendOut: BlendSchema.optional(),
    /** Shake profile fired at `at` seconds. */
    shake: z.object({ profile: IdSchema, at: z.number().min(0) }).strict().optional(),
    /** FOV punch: degrees added at `at`, decaying over `duration`. */
    fovPunch: z.object({ degrees: z.number(), at: z.number().min(0), duration: z.number().positive() }).strict().optional(),
    letterbox: z.boolean().default(false),
  })
  .strict()
  .superRefine((s, ctx) => {
    s.keys.forEach((k, i) => {
      if (i > 0 && k.t <= (s.keys[i - 1]?.t ?? 0)) ctx.addIssue({ code: 'custom', message: 'shot keys must have increasing t' });
      if (k.t > s.duration) ctx.addIssue({ code: 'custom', message: 'shot key beyond duration' });
    });
  });
export type CameraShot = z.infer<typeof CameraShotSchema>;
