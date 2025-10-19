import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Card, Input, Button, SpinnerIcon, DownloadIcon, TrashIcon, BarcodeUrlInput } from './components/ui';

// A4 dimensions and DPI constants
const A4_WIDTH_INCHES = 8.27;
const A4_HEIGHT_INCHES = 11.69;
const DPI = 300;
const A4_WIDTH_PX = A4_WIDTH_INCHES * DPI;
const A4_HEIGHT_PX = A4_HEIGHT_INCHES * DPI;


type ValidationStatus = 'idle' | 'checking' | 'valid' | 'invalid';

interface BarcodeGroup {
  id: number;
  inputValue: string; // What the user types
  resolvedUrl: string; // The final, valid URL for drawing
  validationStatus: ValidationStatus;
  title: string;
  horizontalCount: number;
  verticalCount: number;
  marginTop: number; // in inches, space above this group
}

const App: React.FC = () => {
  const [barcodeGroups, setBarcodeGroups] = useState<BarcodeGroup[]>([
    {
      id: Date.now(),
      inputValue: '1',
      resolvedUrl: '',
      validationStatus: 'idle',
      title: '',
      horizontalCount: 5,
      verticalCount: 10,
      marginTop: 0,
    }
  ]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  
  const validateBarcodeUrl = useCallback(async (id: number, value: string) => {
    if (!value) {
      setBarcodeGroups(prev => prev.map(g => g.id === id ? { ...g, validationStatus: 'idle', resolvedUrl: '' } : g));
      return;
    }
    setBarcodeGroups(prev => prev.map(g => g.id === id ? { ...g, validationStatus: 'checking' } : g));
  
    const isFullUrl = value.startsWith('http://') || value.startsWith('https://');
    
    try {
      let urlToCheck: string;

      if (isFullUrl) {
        urlToCheck = value;
      } else {
        const vercelFunctionUrl = `/api/get-barcode-url?number=${encodeURIComponent(value)}`;
        const functionResponse = await fetch(vercelFunctionUrl);
        
        if (!functionResponse.ok) {
            const errorData = await functionResponse.json();
            throw new Error(errorData.error || `Barcode '${value}' not found.`);
        }
        
        const data = await functionResponse.json();
        if (!data.imageUrl || typeof data.imageUrl !== 'string') {
            throw new Error('Invalid response from lookup service.');
        }
        urlToCheck = data.imageUrl;
      }

      const response = await fetch(urlToCheck, { method: 'HEAD', mode: 'cors' });
      if (response.ok) {
        setBarcodeGroups(prev => prev.map(g => g.id === id ? { ...g, validationStatus: 'valid', resolvedUrl: urlToCheck } : g));
      } else {
        throw new Error("Image URL is not reachable or invalid.");
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown validation error occurred.';
      console.error("Validation error:", errorMessage);
      setBarcodeGroups(prev => prev.map(g => g.id === id ? { ...g, validationStatus: 'invalid', resolvedUrl: '' } : g));
    }
  }, []);


  useEffect(() => {
    const handler = setTimeout(() => {
      barcodeGroups.forEach(group => {
        if (group.inputValue && (group.validationStatus === 'idle')) {
          validateBarcodeUrl(group.id, group.inputValue);
        }
      });
    }, 500);

    return () => {
      clearTimeout(handler);
    };
  }, [barcodeGroups, validateBarcodeUrl]);


  const drawOnCanvas = useCallback(async (canvas: HTMLCanvasElement, groups: BarcodeGroup[], isPreview: boolean) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const logicalCanvasWidth = isPreview ? canvas.offsetWidth : A4_WIDTH_PX;
    const logicalCanvasHeight = isPreview ? canvas.offsetHeight : A4_HEIGHT_PX;
    
    if (isPreview) {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = logicalCanvasWidth * dpr;
        canvas.height = logicalCanvasHeight * dpr;
        ctx.scale(dpr, dpr);
    } else {
        canvas.width = A4_WIDTH_PX;
        canvas.height = A4_HEIGHT_PX;
    }
    
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, logicalCanvasWidth, logicalCanvasHeight);

    const validGroups = groups.filter(g => g.resolvedUrl && g.validationStatus === 'valid' && g.horizontalCount > 0 && g.verticalCount > 0);
    if (validGroups.length === 0) return;

    const drawContent = async () => {
      let currentYOffset = 0;

      for (const group of validGroups) {
        currentYOffset += group.marginTop * DPI;
        
        if (group.title && group.title.trim() !== '') {
            const fontSizePt = 16;
            const fontSizePx = (fontSizePt / 72) * DPI;
            ctx.font = `bold ${fontSizePx}px sans-serif`;
            ctx.fillStyle = 'black';
            ctx.textAlign = 'center';
            const textX = A4_WIDTH_PX / 2;
            const textY = currentYOffset + fontSizePx;
            ctx.fillText(group.title, textX, textY);
            currentYOffset += fontSizePx + (fontSizePx * 0.5);
        }

        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.crossOrigin = "anonymous";
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error(`Failed to load: ${group.resolvedUrl.substring(0, 50)}...`));
          image.src = group.resolvedUrl;
        });

        let barcodeWidth = img.naturalWidth;
        let barcodeHeight = img.naturalHeight;
        if (group.resolvedUrl.toLowerCase().endsWith('.svg')) {
            const assumedBrowserDpi = 96;
            const scaleFactor = DPI / assumedBrowserDpi;
            barcodeWidth *= scaleFactor;
            barcodeHeight *= scaleFactor;
        }

        if (barcodeWidth === 0 || barcodeHeight === 0) {
           throw new Error(`Image from ${group.resolvedUrl.substring(0, 50)}... has zero dimensions.`);
        }
        
        const groupGridWidth = group.horizontalCount * barcodeWidth;
        const groupGridHeight = group.verticalCount * barcodeHeight;

        if (currentYOffset + groupGridHeight > A4_HEIGHT_PX) {
            throw new Error('Content overflows A4 page. Reduce counts or adjust margins.');
        }

        const startX = (A4_WIDTH_PX - groupGridWidth) / 2;
        const startY = currentYOffset;

        for (let y = 0; y < group.verticalCount; y++) {
          for (let x = 0; x < group.horizontalCount; x++) {
            const drawX = startX + x * barcodeWidth;
            const drawY = startY + y * barcodeHeight;
            ctx.drawImage(img, drawX, drawY, barcodeWidth, barcodeHeight);
          }
        }
        
        currentYOffset += groupGridHeight;
      }
    }

    try {
      if (isPreview) {
          const scaleToFit = Math.min(logicalCanvasWidth / A4_WIDTH_PX, logicalCanvasHeight / A4_HEIGHT_PX);
          ctx.save();
          ctx.scale(scaleToFit, scaleToFit);
          await drawContent();
          ctx.restore();
      } else {
          await drawContent();
      }
      setError(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
      setError(errorMessage);
      console.error(err);
      ctx.fillStyle = 'rgba(255, 0, 0, 0.1)';
      ctx.fillRect(0, 0, logicalCanvasWidth, logicalCanvasHeight);
    }
  }, []);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (canvas) {
      const debounceTimeout = setTimeout(() => {
        drawOnCanvas(canvas, barcodeGroups, true);
      }, 300);
      return () => clearTimeout(debounceTimeout);
    }
  }, [JSON.stringify(barcodeGroups), drawOnCanvas]);
  
  const handleAddGroup = () => {
    setBarcodeGroups(prev => [...prev, { id: Date.now(), inputValue: '', resolvedUrl: '', validationStatus: 'idle', title: '', horizontalCount: 5, verticalCount: 10, marginTop: 0.1 }]);
  };

  const handleRemoveGroup = (idToRemove: number) => {
    setBarcodeGroups(prev => prev.filter(b => b.id !== idToRemove));
  };
  
  const handleGroupChange = (idToUpdate: number, field: keyof BarcodeGroup, value: string | number) => {
    setBarcodeGroups(prev => prev.map(group => {
      if (group.id === idToUpdate) {
        if (field === 'inputValue') {
          return {
              ...group,
              inputValue: value as string,
              resolvedUrl: '',
              validationStatus: 'idle',
            };
        }
        if (typeof value === 'string' && (field === 'title')) {
          return { ...group, [field]: value };
        }
        if (typeof value === 'number' && (field === 'horizontalCount' || field === 'verticalCount' || field === 'marginTop')) {
          return { ...group, [field]: value };
        }
      }
      return group;
    }));
  };

  const handleGenerateAndDownload = async () => {
    setIsLoading(true);
    setError(null);
    const offscreenCanvas = document.createElement('canvas');
    await drawOnCanvas(offscreenCanvas, barcodeGroups, false);
    
    offscreenCanvas.toBlob((blob) => {
        if (blob) {
            const link = document.createElement('a');
            link.download = 'barcode-sheet-A4-300dpi.png';
            link.href = URL.createObjectURL(blob);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
        } else {
            setError("Failed to create image blob. The canvas may be empty or too large.");
        }
        setIsLoading(false);
    }, 'image/png');
  };
  
  const isDownloadDisabled = isLoading || barcodeGroups.length === 0 || barcodeGroups.some(g => g.validationStatus !== 'valid' || !g.resolvedUrl || g.horizontalCount <= 0 || g.verticalCount <= 0);

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 sm:p-6 lg:p-8 font-sans">
      <div className="w-full max-w-7xl mx-auto">
        <header className="text-center mb-8">
          <h1 className="text-4xl sm:text-5xl font-bold text-white tracking-tight">Barcode Sheet Generator</h1>
          <p className="mt-2 text-lg text-slate-400">Create printable A4 sheets with your barcodes</p>
        </header>
        
        <main className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 space-y-6">
              <div className="p-6 space-y-6 bg-slate-800/50 border border-slate-700 rounded-xl shadow-lg">
                <h2 className="text-xl font-semibold text-white">Layout Configuration</h2>
                <div className="space-y-6">
                    {barcodeGroups.map((group, index) => (
                      <Card key={group.id} className="bg-slate-900/50 p-4 relative">
                         {barcodeGroups.length > 1 && (
                         <button 
                           onClick={() => handleRemoveGroup(group.id)}
                           className="absolute top-2 right-2 flex-shrink-0 p-1.5 rounded-full hover:bg-slate-700 text-slate-400 hover:text-red-400 transition-colors"
                           aria-label="Remove barcode group"
                         >
                           <TrashIcon />
                         </button>
                       )}
                        <div className="space-y-4">
                          <BarcodeUrlInput
                              label={`Barcode URL or Number ${index + 1}`}
                              id={`barcode-url-${group.id}`}
                              value={group.inputValue}
                              status={group.validationStatus}
                              onChange={(e) => handleGroupChange(group.id, 'inputValue', e.target.value)}
                              placeholder="Enter number or paste full URL"
                            />
                           <Input
                              label="Title (Optional)"
                              id={`title-${group.id}`}
                              type="text"
                              value={group.title}
                              onChange={(e) => handleGroupChange(group.id, 'title', e.target.value)}
                              placeholder="e.g. Product Batch A"
                            />
                           <Input
                                label="Margin Top (in)"
                                id={`margin-top-${group.id}`}
                                type="number"
                                value={group.marginTop.toString()}
                                onChange={(e) => handleGroupChange(group.id, 'marginTop', Math.max(0, parseFloat(e.target.value) || 0))}
                                min="0"
                                step="0.01"
                              />
                          <div className="grid grid-cols-2 gap-4">
                              <Input
                                label="အရေအတွက် ဘေးတိုက်"
                                id={`horizontal-count-${group.id}`}
                                type="number"
                                value={group.horizontalCount.toString()}
                                onChange={(e) => handleGroupChange(group.id, 'horizontalCount', Math.max(0, parseInt(e.target.value, 10) || 0))}
                                min="1"
                              />
                              <Input
                                label="အရေအတွက် ဒေါင်လိုက်"
                                id={`vertical-count-${group.id}`}
                                type="number"
                                value={group.verticalCount.toString()}
                                onChange={(e) => handleGroupChange(group.id, 'verticalCount', Math.max(0, parseInt(e.target.value, 10) || 0))}
                                min="1"
                              />
                          </div>
                        </div>
                      </Card>
                    ))}
                </div>
                 <Button onClick={handleAddGroup} variant="outline" className="w-full">
                  + Add Another Barcode Group
                </Button>
                
                <div className="pt-2">
                  <Button onClick={handleGenerateAndDownload} disabled={isDownloadDisabled} className="w-full">
                    {isLoading ? <SpinnerIcon /> : <DownloadIcon />}
                    <span>{isLoading ? 'Generating...' : 'Generate & Download A4'}</span>
                  </Button>
                </div>
                
                {error && <p className="text-red-400 bg-red-900/20 p-3 rounded-md text-sm">{error}</p>}
              </div>
          </div>
          
          <div className="lg:col-span-2">
            <Card>
                <div className="p-6">
                    <h2 className="text-xl font-semibold text-white mb-4">Live Preview</h2>
                    <div className="aspect-[1/1.414] bg-slate-800 rounded-lg overflow-hidden border border-slate-700">
                        <canvas ref={previewCanvasRef} className="w-full h-full object-contain" />
                    </div>
                     <p className="text-center text-sm text-slate-500 mt-2">This is a scaled-down preview. The downloaded file will be a full-resolution 300 DPI A4 image.</p>
                </div>
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;