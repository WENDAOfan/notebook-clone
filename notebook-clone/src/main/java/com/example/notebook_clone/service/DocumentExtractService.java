package com.example.notebook_clone.service;

import org.apache.pdfbox.pdmodel.PDDocument;//代表一个 PDF 文件对象
import org.apache.pdfbox.text.PDFTextStripper;//负责从 PDF 里"刮出"文字
import org.apache.poi.xwpf.usermodel.XWPFDocument;//代表一个 Word 文件对象
import org.apache.poi.xwpf.usermodel.XWPFParagraph;//代表一个段落对象
import org.springframework.stereotype.Service;//表示这个类是一个服务类，请自动创建并管理它
import org.springframework.web.multipart.MultipartFile;//代表用户上传的文件

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.apache.pdfbox.Loader;
@Service
public class DocumentExtractService {
        /**
     * 根据文件类型提取文本内容
     */
    public String extractText(MultipartFile file) throws IOException {
        String fileName = file.getOriginalFilename();
        if (fileName == null || fileName.isBlank()) {
            throw new IllegalArgumentException("文件名不能为空");
        }

        String lowerCaseName = fileName.toLowerCase();
        String rawText;

        if (lowerCaseName.endsWith(".txt") || lowerCaseName.endsWith(".md")) {
            rawText = new String(file.getBytes(), StandardCharsets.UTF_8);
        }
        else if (lowerCaseName.endsWith(".docx")) {
            try {
                rawText = extractFromDocx(file);
            } catch (Exception e) {
                rawText = "[文档解析失败: " + e.getMessage() + "]\n文件名: " + fileName;
            }
        }
        else if (lowerCaseName.endsWith(".pdf")) {
            try {
                rawText = extractFromPdf(file);
                // 检查提取结果是否为空（扫描版PDF可能提取出空文本）
                if (rawText == null || rawText.strip().isEmpty()) {
                    rawText = "[PDF文本提取为空，该文件可能是扫描版/图片型PDF，暂无法提取文本内容]\n文件名: " + fileName;
                }
            } catch (Exception e) {
                rawText = "[PDF解析失败: " + e.getMessage() + "]\n文件名: " + fileName;
            }
        }
        else {
            throw new UnsupportedOperationException("不支持的文件格式: " + fileName);
        }

        return cleanText(rawText);
    }

    /**
     * 对提取的文本做基础清洗：
     * 1. 去除控制字符（PDF提取常见）
     * 2. 连续3个以上换行合并为2个
     * 3. 过滤PDF水印行（字符间大量空格，如"S e c r e t @ L e v e l"）
     * 4. 去除重复出现的行（每页重复的水印、页眉页脚等）
     * 5. 每行首尾空白去除
     */
    private String cleanText(String raw) {
        // 去除 NUL 和其他控制字符（保留换行\n和回车\r和制表符\t）
        String cleaned = raw.replaceAll("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]", "");
        // 连续3个以上换行合并为2个
        cleaned = cleaned.replaceAll("\\n{3,}", "\n\n");
        // 过滤PDF水印行（字符间大量空格）
        cleaned = removeWatermarkLines(cleaned);
        // 去除重复出现3次以上的行（每页重复的水印、页眉页脚等）
        cleaned = removeRepeatedLines(cleaned);
        // 每行首尾空白去除，保留段落间空行
        cleaned = Arrays.stream(cleaned.split("\\n", -1))
                .map(String::strip)
                .collect(Collectors.joining("\n"));
        return cleaned.trim();
    }

    /**
     * 过滤疑似水印的行：字符间大量单空格、总体长度较长的行
     * 典型水印形态："S e c r e t @ L e v e l : @ P u b l i c"
     * 正常文本极少出现超过40%的空格占比
     */
    private String removeWatermarkLines(String text) {
        return Arrays.stream(text.split("\\n", -1))
                .filter(line -> !isWatermarkLine(line))
                .collect(Collectors.joining("\n"));
    }

    private boolean isWatermarkLine(String line) {
        String trimmed = line.strip();
        if (trimmed.length() < 12) return false;
        long spaceCount = trimmed.chars().filter(c -> c == ' ').count();
        double spaceRatio = (double) spaceCount / trimmed.length();
        // 空格占比超过40%且长度≥12 → 大概率是水印
        return spaceRatio > 0.4;
    }

    /**
     * 去除重复出现3次以上的非空行（常见于每页重复的水印文本、页眉页脚）
     */
    private String removeRepeatedLines(String text) {
        Map<String, Long> lineCounts = Arrays.stream(text.split("\\n"))
                .filter(line -> !line.strip().isEmpty())
                .collect(Collectors.groupingBy(String::strip, Collectors.counting()));
        return Arrays.stream(text.split("\\n", -1))
                .filter(line -> {
                    String stripped = line.strip();
                    if (stripped.isEmpty()) return true;
                    return lineCounts.getOrDefault(stripped, 0L) < 3;
                })
                .collect(Collectors.joining("\n"));
    }
        /**
     * 从 Word 文档提取文本
     */
    private String extractFromDocx(MultipartFile file) throws IOException {
        StringBuilder text = new StringBuilder();//用来保存提取出来的文字
        //拿到上传文件的输入流，交给 POI 去解析
        try (InputStream is = file.getInputStream();
             XWPFDocument document = new XWPFDocument(is)) {
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
            // 按视觉位置排序文本，减少水印/页眉混入正文的情况
            stripper.setSortByPosition(true);
            stripper.setStartPage(1);
            stripper.setEndPage(document.getNumberOfPages());
            return stripper.getText(document);
        }
    }

}

