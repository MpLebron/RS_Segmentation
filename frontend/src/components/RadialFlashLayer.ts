/**
 * Custom WebGL layer for radial flash effect
 * Implements a shader that creates a radial gradient from polygon center
 */
export class RadialFlashLayer {
  id: string
  type: 'custom' = 'custom'
  renderingMode: '2d' = '2d'

  private map?: any
  private program?: WebGLProgram
  private aPos?: number
  private uMatrix?: WebGLUniformLocation | null
  private uCenter?: WebGLUniformLocation | null
  private uProgress?: WebGLUniformLocation | null
  private uOpacity?: WebGLUniformLocation | null
  private buffer?: WebGLBuffer

  // Animation state
  private animationProgress: number = 0
  private geometry: number[][] = []
  private center: [number, number] = [0, 0]
  private isAnimating: boolean = false

  constructor(id: string) {
    this.id = id
  }

  onAdd(map: any, gl: WebGLRenderingContext) {
    this.map = map

    // Vertex shader: pass through position
    const vertexShaderSource = `
      attribute vec2 a_pos;
      uniform mat4 u_matrix;
      varying vec2 v_pos;

      void main() {
        gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
        v_pos = a_pos;
      }
    `

    // Fragment shader: radial gradient from center
    const fragmentShaderSource = `
      precision mediump float;

      uniform vec2 u_center;
      uniform float u_progress;
      uniform float u_opacity;
      varying vec2 v_pos;

      void main() {
        // Calculate distance from center (normalized)
        float dist = distance(v_pos, u_center);

        // Create radial wave effect
        // Progress controls how far the wave has traveled
        float wave = u_progress * 2.0; // Expand wave radius
        float thickness = 0.3; // Wave thickness

        // Calculate alpha based on distance from wave front
        float alpha = 0.0;
        if (dist < wave) {
          // Inside wave - fade based on distance from center
          alpha = (1.0 - dist / wave) * u_opacity;
        }

        // Smooth the edge
        alpha = smoothstep(0.0, 0.1, alpha);

        gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
      }
    `

    // Compile shaders
    const vertexShader = gl.createShader(gl.VERTEX_SHADER)!
    gl.shaderSource(vertexShader, vertexShaderSource)
    gl.compileShader(vertexShader)

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER)!
    gl.shaderSource(fragmentShader, fragmentShaderSource)
    gl.compileShader(fragmentShader)

    // Create and link program
    this.program = gl.createProgram()!
    gl.attachShader(this.program, vertexShader)
    gl.attachShader(this.program, fragmentShader)
    gl.linkProgram(this.program)

    // Get attribute and uniform locations
    this.aPos = gl.getAttribLocation(this.program, 'a_pos')
    this.uMatrix = gl.getUniformLocation(this.program, 'u_matrix')
    this.uCenter = gl.getUniformLocation(this.program, 'u_center')
    this.uProgress = gl.getUniformLocation(this.program, 'u_progress')
    this.uOpacity = gl.getUniformLocation(this.program, 'u_opacity')

    // Create buffer for geometry
    this.buffer = gl.createBuffer()
  }

  setGeometry(coordinates: number[][]) {
    // Convert lng/lat to Mercator projection coordinates
    this.geometry = coordinates.map(coord => {
      return this.lngLatToMercator(coord[0], coord[1])
    })

    // Calculate center of polygon in Mercator coordinates
    if (this.geometry.length > 0) {
      let sumX = 0
      let sumY = 0
      this.geometry.forEach(coord => {
        sumX += coord[0]
        sumY += coord[1]
      })
      this.center = [sumX / this.geometry.length, sumY / this.geometry.length]
    }

    console.log('🗺️ Geometry set:', {
      originalCoords: coordinates.length,
      mercatorCoords: this.geometry.length,
      center: this.center
    })
  }

  // Convert lng/lat to Mercator projection (Web Mercator)
  private lngLatToMercator(lng: number, lat: number): [number, number] {
    const x = (lng + 180) / 360
    const y = (180 - (180 / Math.PI * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)))) / 360
    return [x, y]
  }

  startAnimation() {
    this.isAnimating = true
    this.animationProgress = 0

    console.log('🎬 Starting animation:', {
      isAnimating: this.isAnimating,
      geometryLength: this.geometry.length,
      center: this.center
    })

    const animate = () => {
      if (!this.isAnimating) return

      this.animationProgress += 0.016 // ~60fps, increase by ~1.6% per frame

      if (this.animationProgress >= 1.0) {
        this.isAnimating = false
        this.animationProgress = 0
        console.log('✅ Animation complete')
      } else {
        this.map?.triggerRepaint()
        requestAnimationFrame(animate)
      }
    }

    animate()
  }

  stopAnimation() {
    this.isAnimating = false
    this.animationProgress = 0
  }

  render(gl: WebGLRenderingContext, matrix: number[]) {
    if (!this.program || !this.buffer || this.geometry.length === 0) {
      console.log('⚠️ Render skipped:', {
        hasProgram: !!this.program,
        hasBuffer: !!this.buffer,
        geometryLength: this.geometry.length
      })
      return
    }

    console.log('🎨 Rendering:', {
      progress: this.animationProgress,
      isAnimating: this.isAnimating,
      geometryLength: this.geometry.length
    })

    gl.useProgram(this.program)

    // Bind buffer and upload geometry
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    const positions = new Float32Array(this.geometry.flat())
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)

    // Set attributes
    gl.enableVertexAttribArray(this.aPos!)
    gl.vertexAttribPointer(this.aPos!, 2, gl.FLOAT, false, 0, 0)

    // Set uniforms (with null checks)
    if (this.uMatrix !== null && this.uMatrix !== undefined) {
      gl.uniformMatrix4fv(this.uMatrix, false, matrix)
    }
    if (this.uCenter !== null && this.uCenter !== undefined) {
      gl.uniform2f(this.uCenter, this.center[0], this.center[1])
    }
    if (this.uProgress !== null && this.uProgress !== undefined) {
      gl.uniform1f(this.uProgress, this.animationProgress)
    }

    // Calculate opacity with easeOut
    const easeOut = 1 - Math.pow(this.animationProgress, 1.5)
    if (this.uOpacity !== null && this.uOpacity !== undefined) {
      gl.uniform1f(this.uOpacity, easeOut * 0.85)
    }

    // Enable blending for transparency
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    // Draw triangle fan (assumes convex polygon)
    gl.drawArrays(gl.TRIANGLE_FAN, 0, this.geometry.length)
  }

  onRemove() {
    this.stopAnimation()
  }
}
