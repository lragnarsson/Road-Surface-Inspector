/*
 * Road Surface Inspector
 * Source: https://github.com/lragnarsson/Road-Surface-Inspector
 * License: MIT
 */

class RoadSurfaceInspector {
    constructor(canvas, leftTrack, rightTrack, params) {
        this.canvas = canvas;
        this.leftTrack = leftTrack;
        this.rightTrack = rightTrack;
        this.sampleDistance = params.sampleDistance == null ? 0.1 : params.sampleDistance;
        this.trackWidth = params.trackWidth == null ? 1.55 : params.trackWidth;
        this.laneWidth = params.laneWidth == null ? 3.5 : params.laneWidth;
        this.segmentLength = params.segmentLength == null ? 15 : params.segmentLength;
        this.meshResolutionScale = params.meshResolutionScale == null ? 1 : params.meshResolutionScale;
        this.roadBankingAngle = params.roadBankingAngle == null ? 0 : params.roadBankingAngle;
        this.roadGradeAngle = params.roadGradeAngle == null ? 0 : params.roadGradeAngle;
        this.roadRoughness = params.roadRoughness == null ? 0 : params.roadRoughness;
        this.backgroundColorTop = params.backgroundColorTop == null ? {r: 0.1, g: 0.1, b: 0.4, a: 1} : params.backgroundColorTop;
        this.backgroundColorBottom = params.backgroundColorBottom == null ? {r: 0.01, g: 0.01, b: 0.1, a: 1} : params.backgroundColorBottom;
        this.forceGL1 = params.forceGL1 == null ? false : params.forceGL1;

        this.drag = false;
        this.mouseDX = 0;
        this.mouseDY = 0;
        this.theta = 0;
        this.phi = 0;
        this.mouseOldX = 0;
        this.mouseOldY = 0;

        this.error = null;

        if (!this._initGLContext()) {
            return;
        }

        // Define attribute locations:
        this.VX_BUF = 0;

        if (!this._initShaders()) {
            return;
        }

        this.GL.clearColor(0.3, 0.3, 0.3, 1);

        this._generateSurfaceMesh();

        this._initUniforms();

        this.boundMouseDown = e => this._mouseDown(e);
        this.boundMouseUp = e => this._mouseUp(e);
        this.boundMouseMove = e => this._mouseMove(e);

        this.canvas.addEventListener("mousedown", this.boundMouseDown, false);
        this.canvas.addEventListener("mouseup", this.boundMouseUp, false);
        this.canvas.addEventListener("mouseout", this.boundMouseUp, false);
        this.canvas.addEventListener("mousemove", this.boundMoseMove, false);

        this.draw();
    }


    _initGLContext() {
        this.GL = null;
        this.GLVersion = null;
        if (!this.forceGL1) {
            // Attempt to get a WebGL 2 context:
            try {
                this.GL = this.canvas.getContext("webgl2");
                this.GLVersion = 2;
            } catch(e) {
                console.log("Could not create a WebGL2 context.");
            }
        }

        // Fallback to WebGL 1:
        if (!this.GL) {
            try {
                this.GL = this.canvas.getContext("webgl");
                this.GLVersion = 1;
            } catch(e) {
                console.log("Could not create a WebGL1 context.");
            }
        }

        // Fallback to WebGL experimental (Internet explorer):
        if (!this.GL) {
            try {
                this.GL = this.canvas.getContext("experimental-webgl");
                this.GLVersion = 1;
            } catch(e) {
                console.log("Could not create an experimental-WebGL1 context.");
            }
        }

        if (!this.GL) {
            // Could not get anything
            this.error = "Could not initialize a WebGL context.";
            return false;
        }
        return true;
    }


    _initArrayBuffer(data, bufferType) {
        let buffer = this.GL.createBuffer();
        this.GL.bindBuffer(bufferType, buffer);
        this.GL.bufferData(bufferType, data, this.GL.STATIC_DRAW);
        return buffer;
    }


    _initUniforms() {
        let projection = this._createProjectionMatrix(45, this.canvas.width/this.canvas.height, 0.001, 10000);

        this.GL.viewport(0, 0, this.canvas.width, this.canvas.height);
        this.GL.useProgram(this.surfaceProgram);
        let projLoc = this.GL.getUniformLocation(this.surfaceProgram, 'projection');
        this.GL.uniformMatrix4fv(projLoc, false, projection);
    }


    updateCanvasSize(width, height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this._initUniforms();
    }


    _generateSurfaceMesh() {
        let surfaceIndices = new Uint16Array([
            0,1,2, 0,2,3, 4,5,6, 4,6,7,
            8,9,10, 8,10,11, 12,13,14, 12,14,15,
            16,17,18, 16,18,19, 20,21,22, 20,22,23
         ]);
        let surfaceVertices = new Float32Array([
            -1,-1,-1, 1,-1,-1, 1, 1,-1, -1, 1,-1,
            -1,-1, 1, 1,-1, 1, 1, 1, 1, -1, 1, 1,
            -1,-1,-1, -1, 1,-1, -1, 1, 1, -1,-1, 1,
            1,-1,-1, 1, 1,-1, 1, 1, 1, 1,-1, 1,
            -1,-1,-1, -1,-1, 1, 1,-1, 1, 1,-1,-1,
            -1, 1,-1, -1, 1, 1, 1, 1, 1, 1, 1,-1]);
        this.surfaceIndexBuffer = this._initArrayBuffer(surfaceIndices, this.GL.ELEMENT_ARRAY_BUFFER);
        this.surfaceVertexBuffer = this._initArrayBuffer(surfaceVertices, this.GL.ARRAY_BUFFER);
        this.surfaceIndexSize = surfaceIndices.length;
    }


    draw() {
        // Clear screen:
        this.GL.clear(this.GL.COLOR_BUFFER_BIT);

        if (this.GLVersion == 2) {
            this._drawBackgroundGL2();
            this._drawSurfaceGL2();
        } else if (this.GLVersion == 1) {
            this._drawBackgroundGL1();
            this._drawSurfaceGL1();
        }
    }


    _drawSurfaceGL2() {
        this.GL.useProgram(this.surfaceProgram);

        this.GL.enableVertexAttribArray(this.VX_BUF);
        this.GL.bindBuffer(this.GL.ARRAY_BUFFER, this.surfaceVertexBuffer);
        this.GL.vertexAttribPointer(this.VX_BUF, 3, this.GL.FLOAT, false, 0, 0);

        this.GL.bindBuffer(this.GL.ELEMENT_ARRAY_BUFFER, this.surfaceIndexBuffer);
        this.GL.drawElements(this.GL.TRIANGLES, this.surfaceIndexSize, this.GL.UNSIGNED_SHORT, 0);
    }


    _drawSurfaceGL1() {
        this._drawSurfaceGL2();
    }


    _drawBackgroundGL2() {
        return;
    }


    _drawBackgroundGL1() {
        this._drawBackgroundGL2();
    }


    _mouseDown(e) {
        this.drag = true;
        this.mouseOldX = e.pageX;
        this.mouseOldY = e.pageY;
        e.preventDefault();
        return false;
    }


    _mouseUp(e) {
        this.drag = false;
        console.log("Release");
    }


    _mouseMove(e) {
        if (!this.drag) {
            return false;
        }
        this.mouseDX = (e.pageX - this.mouseOldX) * 2*Math.PI / this.canvas.width,
        this.mouseDY = (e.pageY - this.mouseOldX) * 2*Math.PI / this.canvas.height;
        this.theta += this.mouseDX;
        this.phi += this.mouseDY;
        this.mouseOldX = e.pageX;
        this.mouseOldY = e.pageY;
        e.preventDefault();
        return true;
    }


    _createProjectionMatrix(fovY, aspectRatio, zNear, zFar) {
        let tanFovY = Math.tan(fovY / 2);
        return new Float32Array([1 / (aspectRatio * tanFovY), 0, 0, 0,
                                 0, 1 / (tanFovY), 0, 0,
                                 0, 0, zFar / (zFar - zNear), -1,
                                 0, 0, -(zFar * zNear) / (zFar - zNear), 0]);
    }


    _createShaderProgram(vertexSource, fragmentSource) {
        let vertexShader = this._compileShader(vertexSource, this.GL.VERTEX_SHADER);
        let fragmentShader = this._compileShader(fragmentSource, this.GL.FRAGMENT_SHADER);
        if (!vertexShader || ! fragmentShader) {
            return false;
        }

        let program = this.GL.createProgram();

        // Bind attribute locations
        this.GL.bindAttribLocation(program, this.VX_BUF, 'vertexPos');
        this.GL.attachShader(program, vertexShader);
        this.GL.attachShader(program, fragmentShader);
        this.GL.linkProgram(program);

        if (!this.GL.getProgramParameter(program, this.GL.LINK_STATUS)) {
            this.error = "Could not link shaders: " + this.GL.getProgramInfoLog(program);
            return false;
        }
        return program;
    }


    _compileShader(shaderSource, shaderType) {
        let shader = this.GL.createShader(shaderType);
        this.GL.shaderSource(shader, shaderSource);
        this.GL.compileShader(shader);

        if (!this.GL.getShaderParameter(shader, this.GL.COMPILE_STATUS)) {
            console.log(shaderSource);
            this.error = "Could not compile shader: " + this.GL.getShaderInfoLog(shader);
            return null;
        }
        return shader;
    }


    _initShaders() {
        // Shader source code based on WebGL version:
        let surfaceVertexSource = null;
        let surfaceFragSource = null;
        let backgroundVertexSource = null;
        let backgroundFragSource = null;

        if (this.GLVersion == 2) {
            surfaceVertexSource = `#version 300 es
                                precision highp float;
                                layout(location = 0) in vec3 vertexPos;

                                uniform mat4 model;
                                uniform mat4 view;
                                uniform mat4 projection;

                                void main(void) {
                                    gl_Position = vec4(vertexPos, 1.0);//projection * view * model * vec4(vertexPos, 1.0);
                                }`;


            surfaceFragSource = `#version 300 es
                                precision highp float;

                                out vec4 fragmentColor;

                                void main(void) {
                                    fragmentColor = vec4(1, 0, 0, 1);
                                }`;


            backgroundVertexSource = `#version 300 es
                                precision highp float;
                                layout(location = 0) in vec3 vertexPos;

                                out vec3 backgroundPos;

                                uniform mat4 model;
                                uniform mat4 view;
                                uniform mat4 projection;

                                void main(void) {
                                    backgroundPos = vec3(model * vec4(vertexPos, 1));
                                    gl_Position = projection * view * model * vec4(vertexPos, 1.0);
                                }`;

            backgroundFragSource = `#version 300 es
                                precision highp float;

                                in vec3 backgroundPos;
                                out vec4 fragmentColor;

                                uniform vec4 backgroundColorTop;
                                uniform vec4 backgroundColorBottom;

                                void main(void) {
                                    vec3 unitBackgroundPos = normalize(backgroundPos);
                                    float interp = pow(0.5 * abs(unitBackgroundPos.y + 1.0), 0.6);

                                    fragmentColor = mix(backgroundColorTop, backgroundColorBottom, interp);
                                }`;


        } else if (this.GLVersion == 1 && false) {
            surfaceVertexSource = `#version 100
                                precision highp float;

                                attribute vec3 vertexPos;
                                varying vec4 color;
                                uniform mat4 projection;

                                void main(void) {
                                    gl_Position = vec4(projection * translate *  rotate *  scale * vertexPos, 1.0);
                                }`;
            surfaceFragSource = `#version 100
                          precision highp float;
                          varying vec4 color;

                          void main(void) {
                            gl_FragColor = color;
                          }`;

            surfaceVertexSource = `#version 100
                                precision highp float;

                                attribute vec3 vertexPos;
                                varying vec4 color;
                                uniform mat4 projection;

                                void main(void) {
                                    gl_Position = vec4(projection * translate *  rotate *  scale * vertexPos, 1.0);
                                }`;
            surfaceFragSource = `#version 100
                          precision highp float;
                          varying vec4 color;

                          void main(void) {
                            gl_FragColor = color;
                          }`;
        }


        this.surfaceProgram = this._createShaderProgram(surfaceVertexSource, surfaceFragSource, 'surface');
        this.backgroundProgram = this._createShaderProgram(backgroundVertexSource, backgroundFragSource, 'background');
        return (this.surfaceProgram != false && this.backgroundProgram != false);
    }
}
