/**
* iff.js - IFF/ILBM decoder
*
* Copyright 2011 by Dan Sutherland <djs@djs.org.uk>
*
* TODO:
* - EHB
* - HAM
* - AGA modes (including HAM8)
* - 24-bit truecolour modes
* - aspect ratio (for images with non-square pixels)
* - handle images with no CMAP chunk (create greyscale map)
* - handle non-opaque images
*/

function Iff(createImage) {
    // --- CONSTANTS ---

    // recognised chunk types
    const IFF_CHUNKID_FORM = 0x464f524d;
    const IFF_CHUNKID_ILBM = 0x494c424d; // InterLeaved BitMap
    const IFF_CHUNKID_CMAP = 0x434d4150; // Color MAP
    const IFF_CHUNKID_BMHD = 0x424d4844; // BitMap HeaDer
    const IFF_CHUNKID_BODY = 0x424f4459;
    const IFF_CHUNKID_CAMG = 0x43414d47; // Commadore AMiGa

    // the few fields that are in fixed locations in an IFF/ILBM file
    const IFF_OFF_FORM = 0x00;
    const IFF_OFF_SIZE = 0x04;
    const IFF_OFF_ILBM = 0x08;
    const IFF_OFF_FIRST_CHUNK = 0x0c;

    // BMHD chunk
    const IFF_BMHD_WIDTH = 0x00; // Uint16
    const IFF_BMHD_HEIGHT = 0x02; // Uint16
    const IFF_BMHD_LEFT = 0x04; // Sint16
    const IFF_BMHD_TOP = 0x06; // Sint16
    const IFF_BMHD_BITPLANES = 0x08; // Uint8
    const IFF_BMHD_MASKING = 0x09; // Uint8
    const IFF_BMHD_COMPRESS = 0x0a; // Uint8 (followed by padding byte)
    const IFF_BMHD_TRANSPARENTCOLOR = 0x0c; // Uint16
    const IFF_BMHD_XASPECT = 0x0e; // Uint8
    const IFF_BMHD_YASPECT = 0x0f; // Uint8
    const IFF_BMHD_PAGEWIDTH = 0x10; // Uint16
    const IFF_BMHD_PAGEHEIGHT = 0x12; // Uint16

    const IFF_BMHD_CHUNKSIZE = 0x14;

    // CAMG modes
    const IFF_CAMG_MODE_HAM = 0x0800; // Hold And Modify
    const IFF_CAMG_MODE_EHB = 0x0080; // Extra Half Brite
    const IFF_CAMG_MODE_HIRES = 0x8000; // Hi-res (double horiz pixels)
    const IFF_CAMG_MODE_LACE = 0x4; // Interlaced (double vert pixels)

    // masking
    const IFF_MSK_NONE = 0x00; // image is opaque
    const IFF_MSK_HASMASK = 0x01; // mask interleaved as an extra bitplane
    const IFF_MSK_HASTRANSPARENTCOLOR = 0x02; // GIF-like transparency
    const IFF_MSK_LASSO = 0x03; // MacPaint lasso transparency

    // compression types
    const IFF_CMP_NONE = 0x00;
    const IFF_CMP_BYTERUN1 = 0x01; // UnPackBits aka Run Length Encoding (RLE)

    // set callbacks
    this.createImage = createImage;

    // --- PRIVATE METHODS ---

    /**
    * Handle BMHD chunk
    */
    this._handleBmhd = function(offset, length) {
        if (length != IFF_BMHD_CHUNKSIZE) {
            throw length + ' is wrong size for BMHD chunk';
        }

        // Get necessary values from the bitmap header
        this.width = this.data.getUint16(offset + IFF_BMHD_WIDTH);
        this.height = this.data.getUint16(offset + IFF_BMHD_HEIGHT);
        this.bitplanes = this.data.getUint8(offset + IFF_BMHD_BITPLANES);
        this.compression = this.data.getUint8(offset + IFF_BMHD_COMPRESS);
        this.xaspect = this.data.getUint8(offset + IFF_BMHD_XASPECT);
        this.yaspect = this.data.getUint8(offset + IFF_BMHD_YASPECT);

        if (this.xaspect != this.yaspect) {
            this.warn('Images where aspect ratio is not 1:1 are not '
                + 'currently scaled correctly');
        }

        if (this.compression != IFF_CMP_NONE
         && this.compression != IFF_CMP_BYTERUN1) {
            throw 'Compression type 0x' + this.compression.toString(16) +
                ' is not supported';
        }

        // bytes per row == smallest even integer greater than width / 8
        this.rowBytes = ((this.width + 15) >> 4) << 1;

        this.masking = this.data.getUint8(offset + IFF_BMHD_MASKING);
        
        if (IFF_MSK_LASSO == this.masking) {
            throw 'Lasso masking not supported';
        }

        if (this.masking != IFF_MSK_NONE
            && this.masking != IFF_MSK_HASMASK
            && this.masking != IFF_MSK_HASTRANSPARENTCOLOR
        ) {
            throw 'Unknown masking type 0x' + this.masking.toString(16);
        }

        if (IFF_MSK_HASTRANSPARENTCOLOR == this.masking) {
            this.transparentColour = this.data.getUint16(offset
                + IFF_BMHD_TRANSPARENTCOLOR);
        }

        this.debug('width: ' + this.width);
        this.debug('height: ' + this.height);
        this.debug('bitplanes: ' + this.bitplanes);
        this.debug('xaspect: ' + this.xaspect);
        this.debug('yaspect: ' + this.yaspect);
        this.debug('rowBytes: ' + this.rowBytes);
        this.debug('masking: ' + this.masking.toString(16));
        if (this.transparentColour) {
            this.debug('transparentColour: ' + this.transparentColour);
        }
    }

    /**
    * Handle CAMG chunk
    */
    this._handleCamg = function(offset, length) {
        var camg = this.data.getUint32(offset);
        this.debug('CAMG: ' + camg.toString(16));
//      if (camg & IFF_CAMG_MODE_HAM) {
//          throw 'HAM images are not supported';
//      }

        if (camg & IFF_CAMG_MODE_EHB) {
            throw 'Extra halfbrite mode not supported';
        }

        this.camg = camg;
    }

    /**
    * Handle CMAP chunk
    */
    this._handleCmap = function(offset, length) {
        var cmapEntries = length / 3; // each entry is 3 bytes (R, G, B)
        var expectedEntries = Math.pow(2, this.bitplanes);

        // Check for the unlikely case where the number of colours isn't
        // sufficient for all the image data to be represented by a colour
        if (cmapEntries < expectedEntries) {
            throw 'CMAP ' + cmapEntries + ' too small (should be '
                + expectedEntries + ')';
        }

        // If there are more entries than there should be, warn but continue
        if (cmapEntries > expectedEntries) {
            this.warn('CMAP too large');
        }

        var cmap = new Array();

        // Read CMAP entries into an RGB array
        for (var i = 0; i < cmapEntries; i++) {
            cmap[i] = new Array();
            cmap[i]['r'] = this.data.getUint8(offset + i * 3);
            cmap[i]['g'] = this.data.getUint8(offset + i * 3 + 1);
            cmap[i]['b'] = this.data.getUint8(offset + i * 3 + 2);
        }
        this.debug('CMAP entries: ' + cmapEntries);
        this.cmap = cmap;
    }

    /**
    * Unpack a scanline compressed with the PackBits algorithm (run-length
    * endcoding)
    */
    this._unpackScanline = function() {
        var codeByte;
        var bytesLeft = this.bytesPerScanline;
        var count;
        var outputPos = 0;

        while (bytesLeft) {
            codeByte = this.data.getInt8(this.dataOffset);
            this.dataOffset++;

            if (codeByte >= 0) {
                // Copy next codeByte + 1 bytes literally. 128 here is meant to
                // be a no-op, but we allow it to support broken files
                // created by Adobe Photoshop
                for (var i = 0; i <= codeByte; i++) {
                    this.currentScanline[outputPos]
                            = this.data.getUint8(this.dataOffset);
                    this.dataOffset++;
                    outputPos++;
                    bytesLeft--;
                }
            } else if (codeByte > -128) {
                // Repeat next byte -codeByte + 1 times
                for (var i = 0; i <= -codeByte; i++) {
                    this.currentScanline[outputPos]
                            = this.data.getUint8(this.dataOffset);
                    outputPos++;
                    bytesLeft--;
                }
                this.dataOffset++;
            }
        }
    }

    /**
    * Get next scanline from BODY data, uncompressing if necessary. Result
    * in this.currentScanline
    */
    this._getScanline = function() {
        var i;

        switch (this.compression) {
            case IFF_CMP_BYTERUN1:
                // if compression enabled unpack data into array
                this._unpackScanline();
                break;
            case IFF_CMP_NONE:
                // otherwise copy the BODY data verbatim into array
                for (i = 0; i < this.bytesPerScanline; i++) {
                    this.currentScanline[i]
                        = this.data.getUint8(this.dataOffset);
                    this.dataOffset++;
                }
                break;
            default:
                throw 'Logic exception - impossible compression type';
        }
    }

    /**
    * Uninterleave a scanline putting the result in this.currentOutput
    */
    this._uninterleaveScanline = function() {
        var bytePos = 0;
        var currentPlane;
        var x;
        var currentByte = this.currentScanline[bytePos];
        var bit = 7;
        var totalPlanes = this.bitplanes;

        if (IFF_MSK_HASMASK == this.masking) {
            this.debug('Has masking');
            totalPlanes++;
        }

        for (currentPlane = 0; currentPlane < totalPlanes;
                currentPlane++) {
            for (x = 0; x < this.width; x++) {
                if (bit < 0) {
                    bit = 7;
                    bytePos++;
                    currentByte = this.currentScanline[bytePos];
                }

                if (currentByte & (1 << bit)) {
                    this.currentOutput[x] |= 1 << currentPlane;
                }

                bit--;
            }
        }
    }

    /**
    * Render a single decoded scanline to the canvas
    */
    this._renderScanline = function(y) {
        var x, idx, pixel, transparent;

        for (x = 0; x < this.pixels.width; x++) {
            pixel = x * 4;
            transparent = false;
            idx = this.currentOutput[x];

            if (IFF_MSK_HASMASK == this.masking) {
                if (idx == (1 << this.bitplanes)) {
                    transparent = true;
                } else {
                    idx |= (1 << this.bitplanes);
                }
            }

            if (IFF_MSK_HASTRANSPARENTCOLOR == this.masking
            && idx == this.transparentColour) {
                transparent = true;
            }

            if (transparent) {
                this.pixels.data[pixel    ] = 0;
                this.pixels.data[pixel + 1] = 0;
                this.pixels.data[pixel + 2] = 0;
                this.pixels.data[pixel + 3] = 0;

            } else {
                this.pixels.data[pixel    ] = this.cmap[idx]['r'];
                this.pixels.data[pixel + 1] = this.cmap[idx]['g'];
                this.pixels.data[pixel + 2] = this.cmap[idx]['b'];
                this.pixels.data[pixel + 3] = 0xff;
            }

            this.currentOutput[x] = 0; // clear byte for next time
        }

        this.ctx.putImageData(this.pixels, 0, y);
    }

    /**
    * Handle BODY chunk - this actually decodes and renders the image
    */
    this._handleBody = function(offset, length) {
        // this value is needed often
        this.bytesPerScanline = this.rowBytes * this.bitplanes;

        // init buffer for encoded scanline
        var scanlineBuf = new ArrayBuffer(this.bytesPerScanline);
        this.currentScanline = new Int8Array(scanlineBuf);

        // and unencoded scanline
        var outputBuf = new ArrayBuffer(this.width);
        this.currentOutput = new Uint8Array(outputBuf);

        this.dataOffset = offset;

        this.pixels = this.ctx.createImageData(this.width, 1);

        this.currentY = 0;
    }

    /**
    * Render a single scanline and return
    */
    this.renderScanLine = function() {
        if (this.currentY >= this.height) {
            return false;
        }

        // process and render each scanline
        this._getScanline();
        this._uninterleaveScanline();
        this._renderScanline(this.currentY);
        this.currentY++;

        return true;
    }

    /**
    * Create image canvas
    *
    * Uses callback passed on contruction to create a canvas element and get
    * the 2d drawing context
    */
    this._createImage = function() {
        this.ctx = this.createImage(this.width, this.height);
    }

    // --- PUBLIC METHODS ---
    this.debug = function(msg) {
        console.log(msg);
    }

    this.warn = function(msg) {
        console.log('WARNING: ' + msg);
    }

    this.load = function(buf) {
        var fileSize = buf.byteLength;
        var data = new DataView(buf);

        // ILBM data is always in a FORM chunk
        if (data.getUint32(IFF_OFF_FORM) != IFF_CHUNKID_FORM) {
            throw 'Not an IFF/ILBM file (first chunk not FORM)';
        }

        var formSize = data.getUint32(IFF_OFF_SIZE);

        // byte size specified by the FORM chunk should equal file size minus
        // 4 bytes. we allow it to be smaller in case extra data is appended
        // (the IFF spec allows this)
        if (fileSize < formSize + 4) {
            throw 'FORM size too big for file (FORM chunk size: '
                  + formSize.toString() + ' file size: '
                  + fileSize.toString();
        }

        // ILBM chunk should appear next
        if (data.getUint32(IFF_OFF_ILBM) != IFF_CHUNKID_ILBM) {
            throw 'First chunk in FORM is not ILBM';
        }

        var currentPos = IFF_OFF_FIRST_CHUNK;
        var chunkId, chunkSize;
        this.data = data;

        // loop as long as there are still bytes left in the FORM chunk
        while (currentPos < formSize) {
            chunkId = this.data.getUint32(currentPos);
            chunkSize = this.data.getUint32(currentPos + 4);
            dataPos = currentPos + 8;

            switch (chunkId) {
                case IFF_CHUNKID_BMHD:
                    this._handleBmhd(dataPos, chunkSize);
                    this._createImage();
                    break;
                case IFF_CHUNKID_CMAP:
                    if (this.bitplanes == undefined) {
                        throw 'Invalid file - CMAP chunk before BMHD';
                    }

                    this._handleCmap(dataPos, chunkSize);
                    break;
                case IFF_CHUNKID_CAMG:
                    if (this.bitplanes == undefined) {
                        throw 'Invalid file - CAMG chunk before BMHD';
                    }

                    this._handleCamg(dataPos, chunkSize);
                    break;
                case IFF_CHUNKID_BODY:
                    if (this.bitplanes == undefined) {
                        throw 'Invalid file - BODY chunk before BMHD';
                    }

                    if (this.cmap == undefined) {
                        throw 'Files with no CMAP are not supported';
                    }

                    this._handleBody(dataPos, chunkSize);
                    break;
                default:
                    this.warn('Skipping unrecognised chunk: '
                        + String.fromCharCode(chunkId >> 24)
                        + String.fromCharCode(chunkId >> 16 & 0xff)
                        + String.fromCharCode(chunkId >> 8 & 0xff)
                        + String.fromCharCode(chunkId & 0xff)
                    );
            }

            // chunk size doesn't include ID and size fields (4 bytes each)
            currentPos += chunkSize + 8;

            // chunks must begin on even byte boundary so add 1 padding byte
            // if we're on an odd boundry
            currentPos += currentPos % 2 ? 1 : 0;
        }
    }
}
