app.post('/generate-pdf', verifyCsrfToken, authenticateToken, async (req, res) => {
  const { address, screenshot, polygons, pitches, areas, totalArea } = req.body;

  const doc = new PDFDocument({ margin: 50 });
  let buffers = [];
  doc.on('data', buffers.push.bind(buffers));
  doc.on('end', () => {
    const pdfData = Buffer.concat(buffers);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=roof-measure-report.pdf');
    res.send(pdfData);
  });

  doc.fontSize(20).font('Helvetica-Bold').text('Saskatoon Roof Measure Report', { align: 'center' });
  doc.fontSize(12).font('Helvetica').text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'center' });
  doc.moveDown(2);

  doc.fontSize(14).font('Helvetica-Bold').text('Project Address:', { underline: true });
  doc.fontSize(12).font('Helvetica').text(address || 'Not provided');
  doc.moveDown(1.5);

  if (screenshot) {
    try {
      const imgData = screenshot.replace(/^data:image\/png;base64,/, '');
      const imgBuffer = Buffer.from(imgData, 'base64');
      doc.fontSize(14).font('Helvetica-Bold').text('Map Overview:', { underline: true });
      doc.moveDown(0.5);
      doc.image(imgBuffer, { fit: [500, 300], align: 'center' });
      doc.moveDown(1.5);
    } catch (error) {
      console.error('Error adding screenshot to PDF:', error);
      doc.fontSize(12).text('Unable to include map screenshot.', { align: 'center' });
      doc.moveDown(1.5);
    }
  }

  doc.fontSize(14).font('Helvetica-Bold').text('Area Calculations:', { underline: true });
  doc.moveDown(0.5);
  const tableTop = doc.y;
  const col1 = 50;
  const col2 = 150;
  const col3 = 250;
  doc.fontSize(12).font('Helvetica-Bold').text('Section', col1, tableTop);
  doc.text('Area (SQFT)', col2, tableTop);
  doc.text('Pitch', col3, tableTop);
  doc.moveDown(0.5);
  let yPosition = doc.y;
  areas.forEach((area, index) => {
    doc.fontSize(10).font('Helvetica').text(area.section, col1, yPosition);
    doc.text(area.area, col2, yPosition);
    doc.text(pitches[index] || 'N/A', col3, yPosition);
    yPosition += 15;
  });
  doc.moveDown(1);
  doc.fontSize(12).font('Helvetica-Bold').text(`Total Flat Area: ${totalArea} SQFT`);

  doc.end();
});
