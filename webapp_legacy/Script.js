// Wait for OpenCV to be ready
function onOpenCvReady() {
    console.log("Both OpenCV and Tesseract are ready.");
    initializeScanner();
}

// Main document ready handler
document.addEventListener('DOMContentLoaded', function() {
    checkLibrariesAndInitialize();
});

function checkLibrariesAndInitialize() {
    // Check if both libraries are loaded
    if (typeof cv !== 'undefined' && typeof Tesseract !== 'undefined') {
        onLibrariesReady();
    } else {
        console.log("Waiting for libraries to load...");
        // Set specific callbacks for each library
        if (typeof cv === 'undefined') {
            window.onOpenCvReady = function() {
                console.log("OpenCV.js is ready.");
                checkLibrariesAndInitialize();
            };
        }
        
        // Add this if Tesseract doesn't have a built-in callback mechanism
        if (typeof Tesseract === 'undefined') {
            // Poll for Tesseract every 200ms
            setTimeout(checkLibrariesAndInitialize, 200);
        }
    }
}


function initializeScanner() {
    const video = document.getElementById('webcamFeed');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const scanButton = document.getElementById('scanButton');
    const retakeButton = document.getElementById('retakeButton');
    const clearButton = document.getElementById('clearButton');
    const saveButton = document.getElementById('saveButton');
    const snapshotDisplay = document.getElementById('snapshotDisplay');
    const focusIndicator = document.getElementById('focusIndicator');

    // Initialize focus indicator
    let isFocusCheckEnabled = true;
    let isProcessing = false;

    scanButton.addEventListener('click', function() {
        if (!isProcessing) {
            processIdCard();
        }
    });

    // Improved camera initialization with error handling
    async function initializeCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { 
                    facingMode: 'environment',
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                } 
            });
            video.srcObject = stream;
            await video.play();
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            startVideoProcessing();
        } catch (err) {
            console.error("Camera initialization failed:", err);
            showError("Camera access denied or not available");
        }
    }

    // Show error messages to user
    function showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = message;
        document.body.appendChild(errorDiv);
        setTimeout(() => errorDiv.remove(), 3000);

    }

    // Process individual frame
    function processFrame() {
        if (!isProcessing) {
            isProcessing = true;
            const result = captureAndAnalyzeFrame();
        if (result.cardDetected && result.isFocused) {
            processIdCard();
        } 
        else {
            requestAnimationFrame(processFrame);
        }
            isProcessing = false;
        }
    }

    // Process video frames continuously
    function startVideoProcessing() {
        if (!isProcessing) {
            processFrame();
        }
    }

    // Capture and analyze single frame
    function captureAndAnalyzeFrame() {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const isFocused = checkFocus();
        const cardDetection = detectIdCard();
        return {
            cardDetected: cardDetection.detected,
            isFocused: isFocused
        };
    }

    // Enhanced focus check with dynamic thresholding
    function checkFocus() {
        if (!isFocusCheckEnabled) return true;
        
        let src = cv.imread(canvas);
        let gray = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        
        let laplacian = new cv.Mat();
        cv.Laplacian(gray, laplacian, cv.CV_64F);
        
        let mean = new cv.Mat();
        let stddev = new cv.Mat();
        cv.meanStdDev(laplacian, mean, stddev);
        
        const variance = stddev.data64F[0] * stddev.data64F[0];
        const dynamicThreshold = Math.max(100, canvas.width * 0.1);
        
        [src, gray, laplacian, mean, stddev].forEach(mat => mat.delete());
        
        return variance > dynamicThreshold;
    }

    // Improved ID card detection with perspective correction
    function detectIdCard(){
        
        let src = cv.imread(canvas);
        let dst = new cv.Mat();
        let gray = new cv.Mat();
        let edges = new cv.Mat();
        
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
        cv.Canny(gray, edges, 75, 200);
        
        let contours = new cv.MatVector();
        let hierarchy = new cv.Mat();
        cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        
        let maxArea = 0;
        let maxContourIndex = -1;
        
        for (let i = 0; i < contours.size(); ++i) {
            const contour = contours.get(i);
            const area = cv.contourArea(contour);
            const minArea = src.rows * src.cols * 0.2;
            const maxAreaThreshold = src.rows * src.cols * 0.95;
            
            if (area > maxArea && area > minArea && area < maxAreaThreshold) {
                const perimeter = cv.arcLength(contour, true);
                let approx = new cv.Mat();
                cv.approxPolyDP(contour, approx, 0.02 * perimeter, true);
                
                if (approx.rows === 4) {
                    maxArea = area;
                    maxContourIndex = i;
                }
                approx.delete();
            }
        }
        
        let result = { detected: false, corners: null };
        
        if (maxContourIndex !== -1) {
            const contour = contours.get(maxContourIndex);
            result.detected = true;
            result.corners = getCornerPoints(contour);
            
            if (result.corners) {
                const warped = perspectiveTransform(src, result.corners);
                cv.imshow('canvas', warped);
                warped.delete();
            }
        }
        
        [src, dst, gray, edges, contours, hierarchy].forEach(mat => mat.delete());
        return result;
    }
    
    // Enhanced text recognition with pre-processing
    async function recognizeText(canvas) {
        try {
            if (typeof Tesseract === 'undefined') {
                console.error('Tesseract library not loaded');
                return '';
            }

            // Create status element
            const statusEl = document.createElement('div');
            statusEl.className = 'ocr-status';
            statusEl.textContent = 'Processing text...';
            document.body.appendChild(statusEl);
            
            const config = {
                lang: 'eng',
                tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/-\'." ',
                tessedit_pageseg_mode: '6',
                preserve_interword_spaces: '1',
                tessedit_ocr_engine_mode: '1', // Use Legacy + LSTM mode
                tessjs_create_pdf: '0',
                tessjs_create_hocr: '0',
                tessjs_create_tsv: '0',
                tessjs_create_box: '0',
                tessjs_create_unlv: '0',
                tessjs_create_osd: '0',
                logger: m => {
                    console.log(m);
                    if (m.status === 'recognizing text') {
                        statusEl.textContent = `Recognizing text: ${Math.round(m.progress * 100)}%`;
                    }
                }
            };
            
            const { data: { text } } = await Tesseract.recognize(canvas, config);
            
            // Remove status element
            document.body.removeChild(statusEl);
            
            // Debug: log the recognized text
            console.log("Raw OCR result:", text);
    
            
            return text;
        } catch (error) {
            console.error('Text recognition failed:', error);
            return '';
        }
    }

    async function processIdCard() {

        if(!snapshotDisplay) {
            console.error("snapshot display element not found. Creating one...");
            const imgElement = document.createElement('img');
            imgElement.id = 'snapshotDisplay';
            imgElement.alt = 'ID Snapshot';
            // Append it somewhere appropriate in your document
             document.querySelector('.scanner-container').appendChild(imgElement);
            snapshotDisplay = imgElement;

        }


        try {
            // Disable button to prevent multiple captures
            scanButton.disabled = true;
            
            // Show processing indicator
            showFlashEffect();
            
            // Get video dimensions
            const videoWidth = video.videoWidth;
            const videoHeight = video.videoHeight;
            
            // Initialize canvas at full resolution for better processing
            canvas.width = videoWidth;
            canvas.height = videoHeight;
            ctx.drawImage(video, 0, 0, videoWidth, videoHeight);
            
            // Detect ID card using OpenCV
            let src = cv.imread(canvas);
            let idCardResult = detectIdCard();
            
            if (idCardResult.detected && idCardResult.corners) {
                // Apply perspective correction if card is detected
                const warped = perspectiveTransform(src, idCardResult.corners);
                cv.imshow(canvas, warped);
                warped.delete();
            } else {
                // Fall back to simple cropping if no card detected
                const cropSize = Math.min(videoWidth, videoHeight) * 0.75; 
                const cropX = (videoWidth - cropSize) / 2;
                const cropY = (videoHeight - cropSize) / 2;
                
                // Redraw with crop
                canvas.width = cropSize;
                canvas.height = cropSize;
                ctx.drawImage(video, cropX, cropY, cropSize, cropSize, 0, 0, cropSize, cropSize);
                
                // Basic image enhancement
                src = cv.imread(canvas);
            }
            
            // Apply image enhancement for better OCR
            let enhanced = enhanceImageForOcr(src);
            cv.imshow(canvas, enhanced);
            src.delete();
            enhanced.delete();
            
            // Save snapshot for display
            snapshotDisplay.src = canvas.toDataURL('image/png');
            snapshotDisplay.classList.add('pop-out');
            
            // Perform text recognition with advanced options
            const recognizedText = await recognizeText(canvas);
            
            // Extract data with validation
            const extractedData = extractIdData(recognizedText);
            
            // Update form fields
            updateFormFields(extractedData);
            
            // Log success
            console.log("ID processed successfully");
            
        } catch (error) {
            console.error("Error processing snapshot:", error);
            
            // Show error message to user
            const errorMessage = document.createElement('div');
            errorMessage.className = 'error-message';
            errorMessage.textContent = 'Failed to process ID. Please try again.';
            document.body.appendChild(errorMessage);
            setTimeout(() => errorMessage.remove(), 3000);
            
            // Re-enable scan button on error
            scanButton.disabled = false;

            // Call resetUIAfterProcessing() with failure message
            resetUIAfterProcessing(false);
        }
    }

    // Add this function to check field IDs
    function checkFormFields() {
        const expectedFields = [
            'firstName', 'lastName', 'dob', 'Sex', 'Height', 'Weight', 
            'Eye', 'Address', 'City', 'State', 'Zip', 'dlNumber',
            'Class', 'IssueDate', 'ExpDate'
        ];
    
        console.log("Checking for form fields...");
        for (const field of expectedFields) {
            const element = document.getElementById(field);
            if (!element) {
                console.warn(`Missing form field: ${field}`);
            } 
            else {
                console.log(`Found form field: ${field}`);
            }
        }
    }

       
      
    function updateFormFields(data) {
        console.log("Updating form fields with data:", data);
        
        for (const [field, value] of Object.entries(data)) {
            const element = document.getElementById(field);
            console.log(`Looking for element with id '${field}'`);
            
            if (element) {
                console.log(`Found element for ${field}, setting value to: ${value}`);
                element.value = value;
                // Highlight the field briefly to show it was updated
                element.classList.add('field-updated');
                setTimeout(() => element.classList.remove('field-updated'), 1000);
            } else {
                console.log(`No element found for field: ${field}`);
            }
        }
    }

    function showFlashEffect() {
        const flash = document.querySelector('.flash-effect');
        if (!flash) {
            const flashDiv = document.createElement('div');
            flashDiv.className = 'flash-effect';
            document.body.appendChild(flashDiv);
        }
        flash.style.display = 'block';
        setTimeout(() => flash.style.display = 'none', 300);
    }

    function resetUIAfterProcessing(success = true) {

        const messageElement = document.createElement('div');
        messageElement.className = 'message-display';
        document.body.appendChild(messageElement);

        if (success) {
            messageElement.textContent = "Scan successful! You can now retake or perform another scan.";
            messageElement.style.color = 'green';
        } else {
            messageElement.textContent = "Oops! Something went wrong. Please try again.";
            messageElement.style.color = 'red';
        }
        
        // Enable scan button after a short delay
        setTimeout(() => {
            scanButton.disabled = false;
        }, 2000);
    }

    // Call this function when initializing
     checkFormFields();
    
    // Initialize the scanner
    initializeCamera();
}

// Text cleaning and normalization
function cleanRecognizedText(text) {
    return text
        .replace(/[^\w\s-\/]/g, '')  // Remove special characters except - and /
        .replace(/\s+/g, ' ')        // Normalize whitespace
        .trim();
}

function extractValueAfterKeyword(text, keyword, position, fieldName, extracted) {
    // Get text after keyword
    const afterKeyword = text.substring(position + keyword.length).trim();
    
    // Skip any separators like ":" or spaces
    const valueStart = afterKeyword.search(/[A-Z0-9]/);
    if (valueStart === -1) return;
    
    const valueText = afterKeyword.substring(valueStart);
    
    // Extract based on field type
    switch(fieldName) {
        case 'dob':
        case 'ExpDate':
        case 'IssueDate':
            // Date pattern: extract dates in various formats
            const dateMatch = valueText.match(/(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/);
            if (dateMatch) extracted[fieldName] = dateMatch[1];
            break;
            
        case 'dlNumber':
            // License numbers: alphanumeric with possible dashes
            const dlMatch = valueText.match(/([A-Z0-9\-]+)/);
            if (dlMatch) extracted[fieldName] = dlMatch[1];
            break;
            
        case 'Sex':
            // Sex: just M or F
            const sexMatch = valueText.match(/^([MF])/);
            if (sexMatch) extracted[fieldName] = sexMatch[1];
            break;
            
        case 'Height':
            // Height: various formats like 5'4", 5-4, etc.
            const heightMatch = valueText.match(/(\d'[ ]*\d{1,2}"|'\d{1,2}"|[-\d]{3,5})/);
            if (heightMatch) extracted[fieldName] = heightMatch[1];
            break;
            
        case 'Weight':
            // Weight: number followed by optional units
            const weightMatch = valueText.match(/(\d{2,3}(?:\s*LBS?)?)/);
            if (weightMatch) extracted[fieldName] = weightMatch[1];
            break;
            
        default:
            // Default: extract until next keyword or non-alphanumeric
            const endPos = valueText.search(/(?:^|\s)(?:DOB|SEX|HGT|WGT|EXP|ISS|CLASS|DL|ID)\b/) || valueText.search(/[^A-Z0-9\s\-]/);
            const value = endPos !== -1 ? valueText.substring(0, endPos).trim() : valueText.trim();
            if (value) extracted[fieldName] = value;
    }
}

// Improved data extraction with validation
function extractIdData(text) {
    console.log("Text being processed:", text);
    
    // Normalize text for better matching
    const normalizedText = text.toUpperCase().replace(/\s+/g, ' ');
    
    const extracted = {};
    
    // STEP 1: Pattern recognition for names and address components
    const locationPatterns = [
        // Minnesota style numbered fields
        { 
            firstName: /1\s*([A-Z]+)/i, 
            lastName: /2\s*([A-Z]+(?:\s+[A-Z]+)?)/i,
            address: /3\s*(\d+\s+[A-Z]+(?:\s+[A-Z]+)*\s+[A-Z]+\s+[A-Z])/i,
            apt: /APT\s+(\d+)/i,
            city: /(PLYMOUTH|ST\s+PAUL|MINNEAPOLIS|DULUTH|ROCHESTER|BLOOMINGTON)(?:\s*,)?/i,
            state: /(?:^|\s)([A-Z]{2})(?:\s+|\s*,)/i,
            zip: /(\d{5}(?:-\d{4})?)/i
        },
        // Standard labeled format
        { 
            firstName: /FIRST(?:\s*NAME)?[:.\s]+([A-Z]+)/i, 
            lastName: /LAST(?:\s*NAME)?[:.\s]+([A-Z]+(?:\s+[A-Z]+)?)/i,
            address: /(?:ADDR|ADDRESS)(?:ESS)?[:.\s]+(\d+\s+[A-Z0-9]+(?:\s+[A-Z0-9]+)*(?:\s+(?:ST|AVE|RD|DR|LN|BLVD|WAY|CIR|CT|PL|TER))?)/i,
            city: /CITY[:.\s]+([A-Z]+(?:\s+[A-Z]+)?)/i,
            state: /STATE[:.\s]+([A-Z]{2})/i,
            zip: /(?:ZIP|POSTAL)(?:\s*CODE)?[:.\s]+(\d{5}(?:-\d{4})?)/i
        },
        // Generic positional patterns (looking for typical formats)
        {
            address: /(\d{1,5}\s+[A-Z0-9]+(?:\s+[A-Z0-9]+)*\s+(?:ST|AVE|RD|DR|LN|BLVD|WAY|CIR|CT|PL|TER))/i,
            city: /(?:\d{5}\s+[A-Z0-9]+(?:\s+[A-Z0-9]+)*\s+(?:ST|AVE|RD|DR|LN|BLVD|WAY|CIR|CT|PL|TER)\s+)([A-Z]+(?:\s+[A-Z]+)?)/i,
            state: /(?:[A-Z]+(?:\s+[A-Z]+)?\s+)([A-Z]{2})(?:\s+\d{5})/i,
            zip: /([0-9]{5}(?:-[0-9]{4})?)/i
        }
    ];
    
    // Try each pattern set until we find matches
    for (const patterns of locationPatterns) {
        let foundMatches = 0;
        let attemptedMatches = 0;
        
        for (const [field, pattern] of Object.entries(patterns)) {
            attemptedMatches++;
            const match = normalizedText.match(pattern);
            if (match && match[1]) {
                console.log(`Found pattern match for ${field}:`, match[1]);
                extracted[field] = match[1];
                foundMatches++;
            }
        }
        
        // If we found a good number of matches with this pattern set, stop trying others
        // This helps avoid mixing patterns from different formats
        if (foundMatches > 0 && foundMatches/attemptedMatches > 0.3) {
            console.log(`Using pattern set with ${foundMatches}/${attemptedMatches} matches`);
            break;
        }
    }
    
    // STEP 2: Keyword extraction for remaining fields
    const keywordMap = {
        'DOB': 'dob',
        'BIRTH': 'dob',
        'SEX': 'Sex', 
        'GENDER': 'Sex',
        'HGT': 'Height',
        'HEIGHT': 'Height',
        'WGT': 'Weight',
        'WEIGHT': 'Weight',
        'EYES': 'Eye',
        'EYE COLOR': 'Eye',
        'EXP': 'ExpDate',
        'EXPIRES': 'ExpDate',
        'ISS': 'IssueDate', 
        'ISSUED': 'IssueDate',
        'CLASS': 'Class',
        'DL': 'dlNumber',
        'LICENSE': 'dlNumber',
        'ID': 'dlNumber',
        'DRIVER LICENSE': 'dlNumber',
        // We already tried pattern matching for these, but include as fallback
        'ADDRESS': 'Address',
        'ADDR': 'Address',
        'CITY': 'City',
        'STATE': 'State',
        'ZIP': 'Zip'
    };
    
    // Process each keyword for fields not already found by pattern matching
    for (const [keyword, fieldName] of Object.entries(keywordMap)) {
        // Skip if we already found this field via pattern matching
        if (extracted[fieldName]) continue;
        
        // Find keyword position
        const keywordPos = normalizedText.indexOf(keyword);
        if (keywordPos !== -1) {
            extractValueAfterKeyword(normalizedText, keyword, keywordPos, fieldName, extracted);
        }
    }
    
    // STEP 3: Check for Minnesota-style numbered fields as fallback
    if (!extracted.dlNumber) {
        const dlMatch = normalizedText.match(/4[A-Za-z]?\s*(?:DL#?\s*)?([A-Z0-9\-]+)/i);
        if (dlMatch && dlMatch[1]) {
            extracted.dlNumber = dlMatch[1];
        }
    }
    
    if (!extracted.Sex) {
        const sexMatch = normalizedText.match(/15\s*(?:SEX\s*)?([MF])/i);
        if (sexMatch && sexMatch[1]) {
            extracted.Sex = sexMatch[1];
        }
    }
    
    if (!extracted.Height) {
        const heightMatch = normalizedText.match(/16\s*(?:HGT\s*)?(\d'[ -]*\d{1,2}"?)/i);
        if (heightMatch && heightMatch[1]) {
            extracted.Height = heightMatch[1];
        }
    }
    
    if (!extracted.Weight) {
        const weightMatch = normalizedText.match(/17\s*(?:WGT\s*)?(\d{2,3}\s*(?:LB|KG)?)/i);
        if (weightMatch && weightMatch[1]) {
            extracted.Weight = weightMatch[1];
        }
    }
    
    if (!extracted.Eye) {
        const eyeMatch = normalizedText.match(/18\s*(?:EYES\s*)?([A-Z]{3})/i);
        if (eyeMatch && eyeMatch[1]) {
            extracted.Eye = eyeMatch[1];
        }
    }
    
    // STEP 4: Validate all extracted fields
    for (const field in extracted) {
        const validatedValue = validateField(field, extracted[field]);
        if (validatedValue) {
            extracted[field] = validatedValue;
        } else {
            console.log(`Validation failed for ${field}: ${extracted[field]}`);
            // If validation fails, remove the field
            delete extracted[field];
        }
    }
    
    return extracted;
}

function extractFieldsByPosition(imageData) {
    // This assumes the ID has been properly aligned and perspective-corrected
    
    // Define regions of interest (ROI) for each field
    // These coordinates would need tuning based on your perspective transform
    const regions = {
        lastName: {x: 310, y: 660, width: 200, height: 30},
        firstName: {x: 310, y: 680, width: 200, height: 30},
        address: {x: 310, y: 700, width: 300, height: 30},
        // Add more regions...
    };
    
    const extracted = {};
    
    // Process each region separately
    for (const [field, roi] of Object.entries(regions)) {
        const regionCanvas = document.createElement('canvas');
        regionCanvas.width = roi.width;
        regionCanvas.height = roi.height;
        const ctx = regionCanvas.getContext('2d');
        
        // Draw just this region to the canvas
        ctx.drawImage(
            imageData, 
            roi.x, roi.y, roi.width, roi.height,
            0, 0, roi.width, roi.height
        );
        
        // Process this region with Tesseract
        // This would need to be made async
        Tesseract.recognize(
            regionCanvas,
            'eng',
            { tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/-' }
        ).then(result => {
            extracted[field] = result.data.text.trim();
        });
    }
    
    return extracted;
}

// Field validation
function validateField(field, value) {
    const validators = {
        dob: (val) => {
            const date = new Date(val);
            return !isNaN(date) && date < new Date() ? val : null;
        },
        dlNumber: (val) => /^[A-Z0-9]{1,12}$/.test(val) ? val : null,
        // Add more validators as needed
    };

    return validators[field] ? validators[field](value) : value;
}

// Helper function to enhance image for OCR
function enhanceImageForOcr(src) {
    // Create destination matrix
    const dst = new cv.Mat();
    
    // Convert to grayscale
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // Increase contrast using histogram equalization
    const equalized = new cv.Mat();
    cv.equalizeHist(gray, equalized);

    // Apply adaptive threshold for better text visibility
    const binary = new cv.Mat();
    cv.adaptiveThreshold(equalized, binary, 255, 
        cv.ADAPTIVE_THRESH_GAUSSIAN_C, 
        cv.THRESH_BINARY, 21, 5);  // Increased block size and C value

    // Denoise
    const denoised = new cv.Mat();
    cv.fastNlMeansDenoising(thresh, denoised);

     // Remove glare with thresholding
    const glareRemoved = new cv.Mat();
    cv.threshold(equalized, glareRemoved, 200, 255, cv.THRESH_TOZERO_INV);
    
    // Apply threshold to remove glare and improve contrast
    const thresh = new cv.Mat();
    cv.threshold(denoised, thresh, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    
    // Sharpen the image
    const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
    const temp = new cv.Mat();
    cv.GaussianBlur(denoised, temp, new cv.Size(0, 0), 3);
    cv.addWeighted(denoised, 1.5, temp, -0.5, 0, dst);

    // Close small holes
    cv.morphologyEx(thresh, dst, cv.MORPH_CLOSE, kernel);
    
    // Clean up
    gray.delete();
    equalized.delete();
    glareRemoved.delete();
    binary.delete();
    temp.delete();
    kernel.delete();
    
    return dst;
}

// Get corner points from contour and sort them in correct order
function getCornerPoints(contour) {
    // Get the points from the contour
    let points = [];
    for (let i = 0; i < contour.rows; i++) {
        points.push([contour.data32S[i * 2], contour.data32S[i * 2 + 1]]);
    }

    // Find the center point
    let center = points.reduce((acc, point) => {
        return [acc[0] + point[0] / points.length, acc[1] + point[1] / points.length];
    }, [0, 0]);

    // Sort points based on their position relative to center
    points.sort((a, b) => {
        let angleA = Math.atan2(a[1] - center[1], a[0] - center[0]);
        let angleB = Math.atan2(b[1] - center[1], b[0] - center[0]);
        return angleA - angleB;
    });

    // Ensure the points are in clockwise order: top-left, top-right, bottom-right, bottom-left
    const sumPoints = points.map(p => p[0] + p[1]);
    const diffPoints = points.map(p => p[0] - p[1]);
    
    const corners = {
        topLeft: points[sumPoints.indexOf(Math.min(...sumPoints))],
        topRight: points[diffPoints.indexOf(Math.max(...diffPoints))],
        bottomRight: points[sumPoints.indexOf(Math.max(...sumPoints))],
        bottomLeft: points[diffPoints.indexOf(Math.min(...diffPoints))]
    };

    // Return array of corner points in correct order
    return [
        corners.topLeft,
        corners.topRight,
        corners.bottomRight,
        corners.bottomLeft
    ];
}

// Helper function for perspective transform
function perspectiveTransform(src, corners) {
    const width = 1000;
    const height = 600;
    const dstCorners = cv.matFromArray(4, 1, cv.CV_32FC2, [
        0, 0, width - 1, 0, width - 1, height - 1, 0, height - 1
    ]);
    
    const srcCorners = cv.matFromArray(4, 1, cv.CV_32FC2, corners.flat());
    const perspectiveMatrix = cv.getPerspectiveTransform(srcCorners, dstCorners);
    
    let dst = new cv.Mat();
    cv.warpPerspective(src, dst, perspectiveMatrix, new cv.Size(width, height));
    
    [srcCorners, dstCorners, perspectiveMatrix].forEach(mat => mat.delete());
    return dst;
}















