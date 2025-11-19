const shaderCode = `
struct Attributes {
  @location(0) position: vec2f,
  @location(1) uv: vec2f,
};

struct Varyings {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs_main(a: Attributes) -> Varyings {
  var v: Varyings;

  v.position = vec4f(a.position, 0, 1);
  v.uv = a.uv;

  return v;
}

@fragment
fn fs_main(v: Varyings) -> @location(0) vec4f {
  return vec4f(v.uv, 0, 1);
}
`;

// prettier-ignore
const vertexBuffer = [
     0,  0.5, 1, 0,
  -0.5, -0.5, 0, 1,
   0.5, -0.5, 1, 1,
];

async function setup() {
  const canvas = document.querySelector("canvas");

  if (!canvas) {
    throw new Error("Canvas not found.");
  }

  if (!navigator.gpu) {
    throw new Error("WebGPU not supported.");
  }

  const adapter = await navigator.gpu.requestAdapter({
    featureLevel: "compatibility",
    powerPreference: "high-performance",
  });

  if (!adapter) {
    throw new Error("Couldn't request WebGPU adapter.");
  }

  const neededFeatures = ["core-features-and-limits"];
  const requiredFeatures = [];

  for (const feature of neededFeatures) {
    if (adapter.features.has(feature)) {
      requiredFeatures.push(feature);
    }
  }

  const device = await adapter.requestDevice({
    requiredFeatures,
  });

  const context = canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();

  context.configure({
    device,
    format: canvasFormat,
  });

  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.target === canvas) {
        canvas.width = canvas.clientWidth * window.devicePixelRatio;
        canvas.height = canvas.clientHeight * window.devicePixelRatio;

        context.configure({
          device,
          format: canvasFormat,
        });
      }
    }
  });

  resizeObserver.observe(canvas);

  const shaderModule = device.createShaderModule({
    code: shaderCode,
  });

  const vertexBufferSize = vertexBuffer.length * 4;

  const vertexBufferGPU = device.createBuffer({
    size: vertexBufferSize,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });

  const vertexBufferF32 = new Float32Array(vertexBufferGPU.getMappedRange());

  vertexBufferF32.set(vertexBuffer);

  vertexBufferGPU.unmap();

  const pipelineGPU = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shaderModule,
      buffers: [
        {
          arrayStride: 16,
          attributes: [
            {
              format: "float32x2",
              offset: 0,
              shaderLocation: 0,
            },
            {
              format: "float32x2",
              offset: 8,
              shaderLocation: 1,
            },
          ],
        },
      ],
    },
    fragment: {
      module: shaderModule,
      targets: [
        {
          format: canvasFormat,
        },
      ],
    },
  });

  function frame() {
    const commandEncoder = device.createCommandEncoder();

    const renderPassEncoder = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });

    renderPassEncoder.setVertexBuffer(0, vertexBufferGPU);
    renderPassEncoder.setPipeline(pipelineGPU);
    renderPassEncoder.draw(3);

    renderPassEncoder.end();

    device.queue.submit([commandEncoder.finish()]);

    window.requestAnimationFrame(frame);
  }

  window.requestAnimationFrame(frame);
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await setup();
  } catch (e) {
    if (e instanceof Error) {
      alert(e.message);
    }
  }
});
