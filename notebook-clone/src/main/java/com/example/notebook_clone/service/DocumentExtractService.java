package com.example.notebook_clone.service;

import org.apache.pdfbox.pdmodel.PDDocument;//代表一个 PDF 文件对象
import org.apache.pdfbox.text.PDFTextStripper;//负责从 PDF 里"刮出"文字
import org.apache.poi.xwpf.usermodel.XWPFDocument;//代表一个 Word 文件对象
import org.apache.poi.xwpf.usermodel.XWPFParagraph;//代表一个段落对象
import org.springframework.stereotype.Service;//表示这个类是一个服务类，请自动创建并管理它
import org.springframework.web.multipart.MultipartFile;//代表用户上传的文件

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.apache.pdfbox.Loader;
@Service
public class DocumentExtractService {
        /**
     * 根据文件类型提取文本内容
     */
    public String extractText(MultipartFile file) throws IOException {
        String fileName = file.getOriginalFilename();//
        if (fileName == null) {
            throw new IllegalArgumentException("文件名不能为空");
        }

        String lowerCaseName = fileName.toLowerCase();//转换成小写endsWith(".pdf") 就能正确匹配了

        if (lowerCaseName.endsWith(".txt") || lowerCaseName.endsWith(".md")) {
            // 纯文本文件直接读取
            return new String(file.getBytes(), StandardCharsets.UTF_8);
        } 
        else if (lowerCaseName.endsWith(".docx")) {
            // Word 文档用 POI 解析
            return extractFromDocx(file);
        } 
        else if (lowerCaseName.endsWith(".pdf")) {
            // PDF 用 PDFBox 解析
            return extractFromPdf(file);
        } 
        else {
            throw new UnsupportedOperationException("不支持的文件格式: " + fileName);
        }
    }
        /**
     * 从 Word 文档提取文本
     */
    private String extractFromDocx(MultipartFile file) throws IOException {
        StringBuilder text = new StringBuilder();//用来保存提取出来的文字
        //拿到上传文件的输入流，交给 POI 去解析
        try (XWPFDocument document = new XWPFDocument(file.getInputStream())) {
            //从 Word 文档里取出所有段落的列表
            List<XWPFParagraph> paragraphs = document.getParagraphs();
            for (XWPFParagraph paragraph : paragraphs) {
                //取出一个段落的纯文字每个段落后面加个换行，不然所有段落会黏在一起
                text.append(paragraph.getText()).append("\n");
            }
        }
        return text.toString();
    }
        /**
     * 从 PDF 提取文本
     * 注意：这只能提取文字型 PDF，扫描版/图片型 PDF 无法提取
     */
    private String extractFromPdf(MultipartFile file) throws IOException {
        try (PDDocument document = Loader.loadPDF(file.getBytes())) {
            PDFTextStripper stripper = new PDFTextStripper();
            // 设置提取的页范围（默认全部页面）
            stripper.setStartPage(1);
            stripper.setEndPage(document.getNumberOfPages());
            return stripper.getText(document);
        }
    }

}

