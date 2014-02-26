( function( window ) {

'use strict';

// ----- vars ----- //

var TAU = Math.PI * 2;
var ROOT_2 = Math.sqrt( 2 );

// ----- helpers ----- //

var objToString = Object.prototype.toString;
function isArray( obj ) {
  return objToString.call( obj ) === '[object Array]';
}

// extend objects
function extend( a, b, isDeep ) {
  for ( var prop in b ) {
    var value = b[ prop ];
    if ( isDeep && typeof value === 'object' && !isArray( value )  ) {
      // deep extend
      a[ prop ] = extend( a[ prop ] || {}, value, true );
    } else {
      a[ prop ] = value;
    }
  }
  return a;
}

function insertAfter( elem, afterElem ) {
  var parent = afterElem.parentNode;
  var nextElem = afterElem.nextElementSibling;
  if ( nextElem ) {
    parent.insertBefore( elem, nextElem );
  } else {
    parent.appendChild( elem );
  }
}

var isCanvasSupported = ( function() {
  var isSupported;

  function checkCanvasSupport() {
    if ( isFinite( isSupported ) ) {
      return isSupported;
    }

    var canvas = document.createElement('canvas');
    isSupported = !!( canvas.getContext && canvas.getContext('2d') );
    return isSupported;
  }

  return checkCanvasSupport;
})();

// check that darker composite is supported
var isDarkerSupported = ( function() {
  var isSupported;

  function checkDarkerSupport() {
    if ( isFinite( isSupported ) ) {
      return isSupported;
    }

    var canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    var ctx = canvas.getContext('2d');
    ctx.globalCompositeOperation = 'darker';
    ctx.fillStyle = '#F00';
    ctx.fillRect( 0, 0, 1, 1 );
    ctx.fillStyle = '#999';
    ctx.fillRect( 0, 0, 1, 1 );
    var imgData = ctx.getImageData( 0, 0, 1, 1 ).data;
    return imgData[0] === 153 && imgData[1] === 0;
  }

  return checkDarkerSupport;
})();


// --------------------------  -------------------------- //

var _Halftone = window.BreathingHalftone || {};
var Vector = _Halftone.Vector;
var Particle = _Halftone.Particle;

// -------------------------- BreathingHalftone -------------------------- //

function Halftone( img, options ) {
  // var defaults = this.constructor.defaults;
  // this.options = {};
  this.options = extend( {}, this.constructor.defaults, true );
  extend( this.options, options, true );
  // this.options.displacement = extend( defaults.displacement, options.displacement );
  this.img = img;
  // bail if canvas is not supported
  if ( !isCanvasSupported() ) {
    return;
  }

  this.create();
}

Halftone.defaults = {
  gridSize: 20,
  zoom: 1,
  isAdditive: true,
  channels: [
    'red',
    'green',
    'blue'
  ],
  isChannelLens: true,
  friction: 0.06,
  displacement: {
    hoverRadius: 0.15,
    hoverForce: -0.02,
    activeRadius: 0.3,
    activeForce: 0.01
  },
  dotThreshold: 0.05,
  dotSizeOsc: {
    period: 3,
    delta: 0.2
  }
};

function makeCanvasAndCtx() {
  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext('2d');
  return {
    canvas: canvas,
    ctx: ctx
  };
}



Halftone.prototype.create = function() {
  // create main canvas
  var canvasAndCtx = makeCanvasAndCtx();
  this.canvas = canvasAndCtx.canvas;
  this.ctx = canvasAndCtx.ctx;
  insertAfter( this.canvas, this.img );
  this.img.style.display = 'none';

  // this.img.parentNode.insertBefore();

  this.isDarkerSupported = isDarkerSupported();
  // fall back to lum channel if subtractive and darker isn't supported
  this.channels = !this.options.isAdditive && !this.isDarkerSupported ?
    [ 'lum' ] : this.options.channels;

  // create separate canvases for each color
  this.proxyCanvases = {};
  for ( var i=0, len = this.channels.length; i < len; i++ ) {
    var channel = this.channels[i];
    this.proxyCanvases[ channel ] = makeCanvasAndCtx();
  }

  this.getImageData();

  // properties
  this.canvasPosition = new Vector();
  this.cursorPosition = new Vector();
  this.getCanvasPosition();

  this.bindEvents();

};

Halftone.prototype.getCanvasPosition = function() {
  var rect = this.canvas.getBoundingClientRect();
  var x = rect.left + window.scrollX;
  var y = rect.top + window.scrollY;
  this.canvasPosition.set( x, y );
};

// -------------------------- img -------------------------- //

Halftone.prototype.getImageData = function( callback ) {
  // hack img load
  var src = this.img.src;
  this.img = new Image();
  this.img.onload = function() {
    this.onImgLoad( callback );
  }.bind( this );
  this.img.src = src;
};

Halftone.prototype.onImgLoad = function( callback ) {
  var imgCanvas = document.createElement('canvas');
  var ctx = imgCanvas.getContext('2d');
  var w = imgCanvas.width = this.img.width;
  var h = imgCanvas.height = this.img.height;
  ctx.drawImage( this.img, 0, 0 );
  this.imgData = ctx.getImageData( 0, 0, w, h ).data;

  w *= this.options.zoom;
  h *= this.options.zoom;

  this.width = w;
  this.height = h;
  this.diagonal = Math.sqrt( w*w + h*h );

  // console.log( this.imgData.length );
  // set proxy canvases size
  for ( var prop in this.proxyCanvases ) {
    var proxy = this.proxyCanvases[ prop ];
    proxy.canvas.width = w;
    proxy.canvas.height = h;
  }
  this.canvas.width = w;
  this.canvas.height = h;
  this.initParticles();
  this.animate();


  if ( callback ) {
    callback.call( this );
  }
};

Halftone.prototype.initParticles = function() {

  var getParticlesMethod = this.options.isRadial ?
    'getRadialGridParticles' : 'getCartesianGridParticles';

  // all particles
  this.particles = [];
  // separate array of particles for each color
  this.channelParticles = {};

  var angles = { red: 1, green: 2.5, blue: 5, lum: 4 };

  for ( var i=0, len = this.channels.length; i < len; i++ ) {
    var channel = this.channels[i];
    var angle = angles[ channel ];
    var particles = this[ getParticlesMethod ]( channel, angle );
    // associate with channel
    this.channelParticles[ channel ] = particles;
    // add to all collection
    this.particles = this.particles.concat( particles );
  }

};

Halftone.prototype.animate = function() {
  this.update();
  this.render();
  requestAnimationFrame( this.animate.bind( this ) );
};

Halftone.prototype.update = function() {
  // displace particles with cursors (mouse, touches)
  var displaceOpts = this.options.displacement;
  var forceScale = this.isMousedown ? displaceOpts.activeForce : displaceOpts.hoverForce;
  var radius = this.isMousedown ? displaceOpts.activeRadius : displaceOpts.hoverRadius;
  radius *= this.diagonal;

  for ( var i=0, len = this.particles.length; i < len; i++ ) {
    var particle = this.particles[i];
    // cursor interaction
    var force = Vector.subtract( particle.position, this.cursorPosition );
    var scale = Math.max( 0, radius - force.getMagnitude() ) / radius;
    // scale = Math.cos( scale );
    scale = Math.cos( (1 - scale) * Math.PI ) * 0.5 + 0.5;
    force.scale( scale * forceScale );
    particle.applyForce( force );
    particle.update();
  }
};

Halftone.prototype.render = function() {
  // clear
  this.ctx.globalCompositeOperation = 'source-over';
  this.ctx.fillStyle = this.options.isAdditive ? 'black' : 'white';
  this.ctx.fillRect( 0, 0, this.width, this.height );

  // composite grids
  this.ctx.globalCompositeOperation = this.options.isAdditive ? 'lighter' : 'darker';

  // render channels
  for ( var i=0, len = this.channels.length; i < len; i++ ) {
    var channel = this.channels[i];
    this.renderGrid( channel );
  }

};

var channelFillStyles = {
  additive: {
    red: '#FF0000',
    green: '#00FF00',
    blue: '#0000FF',
    lum: '#FFF'
  },
  subtractive: {
    red: '#00FFFF',
    green: '#FF00FF',
    blue: '#FFFF00',
    lum: '#000'
  }
};

Halftone.prototype.renderGrid = function( channel ) {
  var proxy = this.proxyCanvases[ channel ];
  // clear
  proxy.ctx.fillStyle = this.options.isAdditive ? 'black' : 'white';
  proxy.ctx.fillRect( 0, 0, this.width, this.height );

  // set fill color
  var blend = this.options.isAdditive ? 'additive' : 'subtractive';
  proxy.ctx.fillStyle = channelFillStyles[ blend ][ channel ];

  // render particles
  var particles = this.channelParticles[ channel ];
  for ( var i=0, len = particles.length; i < len; i++ ) {
    var particle = particles[i];
    particle.render( proxy.ctx );
  }

  // draw proxy canvas to actual canvas as whole layer
  this.ctx.drawImage( proxy.canvas, 0, 0 );
};

Halftone.prototype.getCartesianGridParticles = function( channel, angle ) {
  var particles = [];

  var w = this.width;
  var h = this.height;

  var diag = Math.max( w, h ) * ROOT_2;

  var gridSize = this.options.gridSize;
  var cols = Math.ceil( diag / gridSize );
  var rows = Math.ceil( diag / gridSize );

  for ( var row = 0; row < rows; row++ ) {
    for ( var col = 0; col < cols; col++ ) {
      var x1 = ( col + 0.5 ) * gridSize;
      var y1 = ( row + 0.5 ) * gridSize;
      // offset for diagonal
      x1 -= ( diag - w ) / 2;
      y1 -= ( diag - h ) / 2;
      // shift to center
      x1 -= w / 2;
      y1 -= h / 2;
      // rotate grid
      var x2 = x1 * Math.cos( angle ) - y1 * Math.sin( angle );
      var y2 = x1 * Math.sin( angle ) + y1 * Math.cos( angle );
      // shift back
      x2 += w / 2;
      y2 += h / 2;

      var particle = this.initParticle( channel, x2, y2 );
      if ( particle ) {
        particles.push( particle );
      }
    }
  }

  return particles;
};

Halftone.prototype.getRadialGridParticles = function( channel, angle ) {
  var particles = [];

  var w = this.width;
  var h = this.height;
  var diag = Math.max( w, h ) * ROOT_2;

  var gridSize = this.options.gridSize;

  var halfW = w / 2;
  var halfH = h / 2;
  var offset = gridSize;
  var centerX = halfW + Math.cos( angle ) * offset;
  var centerY = halfH + Math.sin( angle ) * offset;

  var maxLevel = Math.ceil( ( diag + offset ) / gridSize );

  for ( var level=0; level < maxLevel; level++ ) {
    var max = level * 6 || 1;
    for ( var j=0; j < max; j++ ) {
      var theta = TAU * j / max + angle;
      var x = centerX + Math.cos( theta ) * level * gridSize;
      var y = centerY + Math.sin( theta ) * level * gridSize;
      var particle = this.initParticle( channel, x, y );
      if ( particle ) {
        particles.push( particle );
      }
    }
  }

  return particles;

};

function isOutside( x, y, w, h ) {
  return x < 0 || x > w || y < 0 || y > h;
}

Halftone.prototype.initParticle = function( channel, x2, y2 ) {
  // don't render if coords are outside image
  // don't display if under threshold
  var pixelChannelValue = this.getPixelChannelValue( x2, y2, channel );
  if ( pixelChannelValue < this.options.dotThreshold ) {
    return;
  }

  return new Particle({
    channel: channel,
    parent: this,
    origin: new Vector( x2, y2 ),
    naturalSize: this.options.gridSize * ROOT_2 / 2,
    friction: this.options.friction
  });

};

var channelOffset = {
  red: 0,
  green: 1,
  blue: 2
};

Halftone.prototype.getPixelChannelValue = function( x, y, channel ) {
  x = Math.round( x / this.options.zoom );
  y = Math.round( y / this.options.zoom );

  if ( isOutside( x, y, this.img.width, this.img.height ) ) {
    return 0;
  }

  var pixelIndex = ( x + y * this.img.width ) * 4;
  var value;
  // return 1;
  if ( channel === 'lum' ) {
    value = this.getPixelLum( pixelIndex );
  } else {
    // rgb
    var index = pixelIndex + channelOffset[ channel ];
    value = this.imgData[ index ] / 255;
  }

  value = value || 0;
  if ( !this.options.isAdditive ) {
    value = 1 - value;
  }

  return value;
};

Halftone.prototype.getPixelLum = function( pixelIndex ) {
  // thx @jfsiii
  // https://github.com/jfsiii/chromath/blob/master/src/chromath.js
  var r = this.imgData[ pixelIndex + 0 ] / 255;
  var g = this.imgData[ pixelIndex + 1 ] / 255;
  var b = this.imgData[ pixelIndex + 2 ] / 255;
  var max = Math.max( r, g, b );
  var min = Math.min( r, g, b );
  return ( max + min ) / 2;
};

// ----- bindEvents ----- //

Halftone.prototype.bindEvents = function() {
  this.canvas.addEventListener( 'mousedown', this, false );
  window.addEventListener( 'mousemove', this, false );
  window.addEventListener( 'resize', this, false );
};

Halftone.prototype.handleEvent = function( event ) {
  var method = 'on' + event.type;
  if ( this[ method ] ) {
    this[ method ]( event );
  }
};

Halftone.prototype.onmousedown = function( event ) {
  event.preventDefault();
  this.isMousedown = true;
  window.addEventListener( 'mouseup', this, false );
};

Halftone.prototype.onmouseup = function() {
  this.isMousedown = false;
  window.removeEventListener( 'mouseup', this, false );
};

Halftone.prototype.onmousemove = function( event ) {
  // set cursorPositon
  this.cursorPosition.set( event.pageX, event.pageY );
  this.cursorPosition.subtract( this.canvasPosition );
};

function debounceProto( _class, methodName, threshold ) {
  // original method
  var method = _class.prototype[ methodName ];
  var timeoutName = methodName + 'Timeout';

  _class.prototype[ methodName ] = function() {
    var timeout = this[ timeoutName ];
    if ( timeout ) {
      clearTimeout( timeout );
    }
    var args = arguments;

    this[ timeoutName ] = setTimeout( function() {
      method.apply( this, args );
      delete this[ timeoutName ];
    }.bind( this ), threshold || 100 );
  };
}

Halftone.prototype.onresize = function() {
  this.getCanvasPosition();
};

debounceProto( Halftone, 'onresize', 200 );


// --------------------------  -------------------------- //

Halftone.Vector = Vector;
Halftone.Particle = Particle;
window.BreathingHalftone = Halftone;


})( window );

