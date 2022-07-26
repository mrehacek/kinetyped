import opentype from "opentype.js";
import p5 from "p5";
import { interpolate_glyphs } from "../libs/kinetyped";
import { KT_DataDraw, KT_DataSetup, KT_Glyph, KT_P5, KT_SketchClosure, KT_SketchDataClosure } from "../types";

export interface KT_DataSetup_Noise extends KT_DataSetup {
  canvasWidth: number;
  canvasHeight: number;
  useWebGL: boolean;
  text: string;
  interpolationResolution: number;
  posX: number;
  posY: number;
  fontSize: number;
  fontPath: string;
  backgroundColor: string;
}

export interface KT_DataDraw_Noise extends KT_DataDraw {
  debugVisualization: boolean;
  debugControlPoints: boolean;
  connectGlyphPointsToMousePos: boolean;
  drawShapes: boolean;
  shapeColor: string;
  frameFadeoutStrength: number;
  drawingMethod: KT_DrawingMethod;
  drawCurves: boolean;
  pointSize: number;
  lineWeight: number;
  noise: {
    enabled: boolean;
    animate: boolean;
    speed: number;
    strength: number;
    mouse: {
      enabled: boolean;
      decayDistance: number;
      decayFactor: number;
    };
  };
  webgl: {
    useShader: boolean;
  };
}

export enum KT_DrawingMethod {
  SHAPES = "shapes",
  POINTS = "points",
  WEBGL_SHAPES = "webgl_shapes",
}

export interface KT_P5_Example extends KT_P5 {
  removeAll: () => void;
}

// @ts-expect-error
const sketch_data_wrap: KT_SketchDataClosure = (data_setup: KT_DataSetup_Example, data_draw: KT_DataDraw_Example) => {
  // @ts-expect-error
  const sketch: KT_SketchClosure = async (p: KT_P5_Example) => {
    let font: opentype.Font;
    let current_fontPath: string; // remember to avoid reloading when reset() is called
    let glyphs: opentype.Path[];
    let points_all: p5.Vector[];
    let points_separated: KT_Glyph[];
    let max_noise_val: number = 0;

    let buf_glyph_vis: p5.Graphics;
    let buf_main: p5.Graphics;
    let buf_texture: p5.Graphics;
    let shader: p5.Shader;

    // when the glyph points are displaced by noise in each frame, is is temporary
    // we store the noise values here and subtract them after render
    let noises = new Map<number, { x: number; y: number } | null>();

    async function load_font() {
      font = await opentype.load(data_setup.fontPath);
      current_fontPath = data_setup.fontPath;
    }

    async function generate_glyphs_and_resize() {
      const text_width = font.getAdvanceWidth(data_setup.text, data_setup.fontSize);
      data_setup.canvasWidth = text_width + 250 * p.map(text_width, 0, 500, 0.01, 1);
      data_setup.canvasHeight = data_setup.fontSize * 1.5;
      const mx = (data_setup.canvasWidth - text_width) / 2 - text_width * 0.06;
      const my = (data_setup.canvasHeight - data_setup.fontSize) / 2 + data_setup.fontSize * 0.85;
      glyphs = await font.getPaths(data_setup.text, mx, my, data_setup.fontSize);
      p.resizeCanvas(data_setup.canvasWidth, data_setup.canvasHeight);
    }

    p.removeAll = function () {
      buf_glyph_vis.remove();
      buf_main.remove();
      buf_texture?.remove();
      p.remove();
    };

    p.preload = async function () {
      shader = await p.loadShader("shaders/recursive-noise/uniform.vert", "shaders/recursive-noise/uniform.frag");
      await load_font();
      await generate_glyphs_and_resize();
    };

    p.setup = function () {
      console.log("Sketch setup()");

      points_all = [];
      points_separated = [];

      p.createCanvas(data_setup.canvasWidth, data_setup.canvasHeight);
      p.colorMode(p.HSB);
      p.pixelDensity(1); // prevent retina screens to render weirdly in WEBGL mode
      p.noStroke();
      buf_main = p.createGraphics(p.width, p.height, p.WEBGL);
      buf_main.colorMode(p.HSB);
      buf_texture = p.createGraphics(p.width, p.height, p.WEBGL);
      buf_glyph_vis = p.createGraphics(p.width, p.height);

      // in WEBGL mode, move origin from center of the screen to the top left corner
      if (data_setup.useWebGL) {
        buf_texture.noStroke();
        buf_texture.translate(-p.width / 2, -p.height / 2);
        buf_main.translate(-p.width / 2, -p.height / 2);
        p.translate(-p.width / 2, -p.height / 2);
      }

      if (glyphs) {
        recalculate_glyph_points();
      } else {
        setTimeout(async function () {
          recalculate_glyph_points();
        }, 100);
      }
    };

    function recalculate_glyph_points() {
      ({ points_all, points_separated } = interpolate_glyphs(
        glyphs,
        data_setup.interpolationResolution,
        buf_glyph_vis
      ));
    }

    p.reset = async function () {
      console.log("Sketch reset()");
      p.clear();
      if (current_fontPath != data_setup.fontPath) {
        await load_font();
      }

      buf_glyph_vis.resizeCanvas(p.width, p.height);
      buf_main.resizeCanvas(p.width, p.height);
      buf_main.reset();
      buf_main.translate(-p.width / 2, -p.height / 2);
      buf_texture?.resizeCanvas(p.width, p.height);
      buf_texture?.reset();
      buf_texture?.translate(-p.width / 2, -p.height / 2);

      await generate_glyphs_and_resize();
      recalculate_glyph_points();
    };

    p.draw = function () {
      if (!glyphs || !shader || !points_all || !points_separated) {
        return;
      }

      p.push();
      if (data_setup.useWebGL) {
        //p.translate(-p.width / 2, -p.height / 2);
      } else {
        p.blendMode(p.BLEND); // TODO: anyways?
      }

      // Frame fadeout - cleaning
      // tried using tint(100, x) to make frames transparent, however it is very performance-heavy and unusable
      // @ts-expect-error
      buf_main.clear();
      buf_main.background(data_setup.backgroundColor);
      if (data_draw.frameFadeoutStrength == 1) {
        p.clear();
        p.background(data_setup.backgroundColor);
      } else {
        // fade frame out
        const c = p.color(data_setup.backgroundColor);
        c.setAlpha(p.map(p.pow(data_draw.frameFadeoutStrength, 4), 0, 1, 0.01, 1));
        p.background(c);
      }

      // TODO: can be turned off to only view triangle strip
      if (data_draw.drawingMethod === KT_DrawingMethod.WEBGL_SHAPES && data_draw.webgl.useShader && buf_texture) {
        buf_texture.shader(shader);
        const sc = 1.0;
        shader.setUniform("u_resolution", [p.width * sc, p.height * sc]);
        shader.setUniform("u_time", p.millis() / 1000.0);
        shader.setUniform("u_mouse", [p.mouseX, p.map(p.mouseY, 0, p.height * sc, p.height * sc, 0)]);
        buf_texture.rect(0, 0, p.width, p.height);
        //p.image(buf_texture,0,0);
      }

      if (data_draw.noise.enabled) {
        displacePointsByNoise(points_all);
      }

      //
      // DRAWING GLYPHS
      //
      for (const glyph of points_separated) {
        if (data_draw.drawingMethod === KT_DrawingMethod.POINTS && data_draw.connectGlyphPointsToMousePos) {
          for (const v of glyph.all) {
            const mouseDistance = p.sqrt(p.pow(v.x - p.mouseX, 2) + p.pow(v.y - p.mouseY, 2));
            const c_stroke = p.color(data_draw.shapeColor);
            c_stroke.setAlpha(p.map(mouseDistance, 0, 400, 1, 0));
            p.stroke(c_stroke);
            p.strokeWeight(data_draw.lineWeight);
            p.line(v.x, v.y, p.mouseX, p.mouseY);
          }
        } else if (data_draw.drawingMethod === KT_DrawingMethod.SHAPES) {
          p.fill(data_draw.shapeColor);
          drawShapeFromPoints(p, glyph);
        } else if (data_draw.drawingMethod === KT_DrawingMethod.WEBGL_SHAPES) {
          if (data_draw.webgl.useShader && buf_texture) {
            buf_main.texture(buf_texture);
            buf_main.noStroke();
            drawShapeFromPoints(buf_main, glyph, p.TRIANGLE_STRIP, true);
          } else {
            buf_main.stroke(0, 0, 0, 0);
            buf_main.fill(data_draw.shapeColor);
            drawShapeFromPoints(buf_main, glyph, p.TRIANGLE_FAN);
          }
        }
      }

      if (data_draw.drawingMethod === KT_DrawingMethod.POINTS) {
        for (const g_points of points_separated) {
          data_draw.debugVisualization ? drawPointsDebug(p, g_points.all) : drawPoints(p, g_points.all);
        }
      }

      if (data_draw.debugVisualization) {
        for (const v of points_all) {
          buf_glyph_vis.fill(0, 0, 0, 0.5);
          buf_glyph_vis.noStroke();
          buf_glyph_vis.circle(v.x, v.y, 2);
        }
        if (data_draw.debugControlPoints) {
          p.image(buf_glyph_vis, 0, 0);
        }
      }

      if (data_draw.noise.enabled) {
        resetNoiseDisplacement(points_all);
      }

      if (data_draw.drawingMethod === KT_DrawingMethod.WEBGL_SHAPES) {
        p.image(buf_main, 0, 0);
      }

      p.pop();
    };

    function drawShapeFromPoints(
      p: p5,
      glyph: KT_Glyph,
      shapeType: p5.BEGIN_KIND | null = null,
      skipContouring: boolean = false
    ) {
      if (shapeType === null) {
        p.beginShape();
      } else {
        p.beginShape(shapeType);
      }

      // shape
      let shape_points = skipContouring ? glyph.all : glyph.shape;
      let first_v = shape_points[0];
      let second_v = shape_points[1];
      let almost_last_v = shape_points[shape_points.length - 2];
      let last_v = shape_points[shape_points.length - 1];

      if (shapeType === null && data_draw.drawCurves) {
        // curves
        //p.curveVertex(almost_last_v.x, almost_last_v.y);
        //p.curveVertex(last_v.x, last_v.y);
        for (const v of shape_points) {
          p.curveVertex(v.x, v.y);
        }
        //p.curveVertex(first_v.x, first_v.y);
        //p.curveVertex(second_v.x, second_v.y);
      } else {
        // lines
        for (const v of shape_points) {
          p.vertex(v.x, v.y);
        }
      }

      // contour, not possible in webgl
      if (glyph.contour.length > 2 && !skipContouring) {
        p.beginContour();
        if (shapeType === null && data_draw.drawCurves) {
          // curves
          let first_v = glyph.contour[0];
          let second_v = glyph.contour[1];
          let almost_last_v = shape_points[glyph.contour.length - 2];
          let last_v = glyph.contour[glyph.contour.length - 1];
          //p.curveVertex(almost_last_v.x, almost_last_v.y);
          //p.curveVertex(last_v.x, last_v.y);
          for (const v of glyph.contour) {
            p.curveVertex(v.x, v.y);
          }
          //p.curveVertex(first_v.x, first_v.y);
          //p.curveVertex(second_v.x, second_v.y);
        } else {
          // lines
          for (const v of glyph.contour) {
            p.vertex(v.x, v.y);
          }
        }
        p.endContour();
      }

      p.endShape(p.CLOSE);
    }

    function drawPoints(p: p5, points: p5.Vector[]) {
      p.push();
      p.noStroke();
      for (const v of points) {
        p.fill(data_draw.shapeColor);
        p.circle(v.x, v.y, data_draw.pointSize);
      }
      p.pop();
    }

    function drawPointsDebug(p: p5, points: p5.Vector[]) {
      p.push();
      p.noStroke();
      let c_fading = p.color(data_draw.shapeColor);

      let first = true;
      let i = 0;
      for (const v of points) {
        if (first) {
          p.fill(100, 100, 100);
          first = false;
        } else if (i === points.length - 1) {
          p.fill(0, 100, 100);
        } else {
          p.fill(c_fading);
        }
        p.circle(v.x, v.y, data_draw.pointSize);
        c_fading.setAlpha(p.map(i, 0, points.length, 1, 0));
        i++;
      }
      p.pop();
    }

    function displacePointsByNoise(points: p5.Vector[]) {
      let i = 0;
      max_noise_val = 0;
      for (const v of points) {
        let mouseChangeX = 1;
        let mouseChangeY = 1;
        if (data_draw.noise.mouse.enabled) {
          mouseChangeX =
            Math.abs(p.mouseX - v.x) ** data_draw.noise.mouse.decayFactor / data_draw.noise.mouse.decayDistance;
          mouseChangeY =
            Math.abs(p.mouseY - v.y) ** data_draw.noise.mouse.decayFactor / data_draw.noise.mouse.decayDistance;
        }
        let animParam = 0;
        if (data_draw.noise.animate) {
          animParam = p.millis() / p.pow(p.map(data_draw.noise.speed, 1, 100, 10, 100000), 0.7);
        }

        const noise = {
          x: p.map(p.noise(v.x, animParam, v.y) * mouseChangeX, 0, 1, -1, 1),
          y: p.map(p.noise(v.y, animParam, v.x) * mouseChangeY, 0, 1, -1, 1),
        };
        v.x += noise.x * data_draw.noise.strength;
        v.y += noise.y * data_draw.noise.strength;
        noises.set(i, noise);
        const dst = noise.x + noise.y;
        if (dst > max_noise_val) {
          max_noise_val = dst;
        }
        i++;
      }
    }

    function resetNoiseDisplacement(points: p5.Vector[]) {
      if (!noises || !noises.get(0)) return;

      let i = 0;
      for (const v of points) {
        const n = noises.get(i);
        if (n?.x === undefined || n?.y === undefined) return;
        v.x -= n.x * data_draw.noise.strength;
        v.y -= n.y * data_draw.noise.strength;
        noises.set(i, null);
        i++;
      }
    }
  };
  return sketch;
};

export default sketch_data_wrap;
