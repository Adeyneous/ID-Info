// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {

    
    // Get references to DOM elements
    const video = document.getElementById('webcamFeed');
    const scanButton = document.getElementById('scanButton'); // Fixed ID to match your HTML
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // Only proceed if elements are found
    if (!video || !scanButton) {
        console.error("Required elements not found. Make sure webcamFeed and scanButton exist.");
        return;
    }

    // Initialize camera
    navigator.mediaDevices.getUserMedia({ 
        video: { 
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 }
        }
    })
    .then(stream => {
        video.srcObject = stream;
    })
    .catch(err => {
        console.error("Error accessing the camera", err);
    });

    // Process ID when scan button is clicked
    scanButton.addEventListener('click', function() {
        // Make sure video is initialized
        if (!video.videoWidth) {
            console.error("Video not initialized yet");
            return;
        }

        // Capture frame from video
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Show processing indicator if it exists
        const statusMessage = document.getElementById('statusMessage');
        if (statusMessage) {
            statusMessage.textContent = "Processing image...";
            statusMessage.style.display = 'block';
        }
        
        // Perform OCR using Tesseract.js
        if (typeof Tesseract === 'undefined') {
            console.error("Tesseract library not loaded");
            if (statusMessage) {
                statusMessage.textContent = "Text recognition failed - library not loaded";
                setTimeout(() => statusMessage.style.display = 'none', 3000);
            }
            return;
        }
        
        Tesseract.recognize(
            canvas,
            'eng',
            { logger: m => console.log(m) }
        ).then(({ data: { text } }) => {
            console.log("Recognized text:", text);
            
            // Extract data using regex patterns
            const extractedData = extractIdData(text);
            updateFormFields(extractedData);
            
            if (statusMessage) {
                statusMessage.textContent = "Processing complete";
                setTimeout(() => statusMessage.style.display = 'none', 2000);
            }
        }).catch(error => {
            console.error("Text recognition failed:", error);
            if (statusMessage) {
                statusMessage.textContent = "Text recognition failed";
                setTimeout(() => statusMessage.style.display = 'none', 3000);
            }
        });
    });
    
    // Extract data from recognized text
    function extractIdData(text) {
        const patterns = {
            firstName: /First\s*Name:?\s*([A-Z]+)/i,
            lastName: /Last\s*Name:?\s*([A-Z]+)/i,
            dob: /DOB:?\s*(\d{2}\/\d{2}\/\d{4})/i,
            sex: /SEX:\s*([MF])/i,
            hgt: /HGT:\s*(\d+)\s*in\b/i,
            wgt: /WGT:\s*(\d+)\s*lb\b/i,
            eyes: /EYES:\s*(\w+)/i,
            address: /Address:\s*([\w\s,]+)/i,
            city: /City:\s*([\w\s]+)/i,
            state: /State:\s*([A-Z]{2})/i,
            zipCode: /Zip Code:\s*(\d{5})/i,
            dlNumber: /DL#:?\s*([A-Z0-9]+)/i,
            dlClass: /Class:\s*([\w\d]+)/i,
            issDate: /\bISS:\s*(\d{2}\/\d{2}\/\d{4})\b/i,
            expDate: /\bEXP:\s*(\d{2}\/\d{2}\/\d{4})\b/i
        };

        const extracted = {};
        for (const [field, pattern] of Object.entries(patterns)) {
            const match = text.match(pattern);
            if (match && match[1]) {
                extracted[field] = match[1].trim();
            }
        }
        
        return extracted;
    }
    
    // Update form fields with extracted data
    function updateFormFields(data) {
        for (const [field, value] of Object.entries(data)) {
            const element = document.getElementById(field);
            if (element && value) {
                element.value = value;
                // Highlight updated field
                element.classList.add('field-updated');
                setTimeout(() => element.classList.remove('field-updated'), 1000);
            }
        }
    }
});
