package com.example.notebook_clone.controller;

import com.example.notebook_clone.entity.Document;
import com.example.notebook_clone.entity.Notebook;
import com.example.notebook_clone.repository.DocumentRepository;
import com.example.notebook_clone.repository.NotebookRepository;


import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;

import org.springframework.web.multipart.MultipartFile;
import java.nio.charset.StandardCharsets;
import java.io.IOException;
import jakarta.validation.Valid;
import com.example.notebook_clone.common.Result;
@RestController
@RequestMapping("/api/documents") 
public class DocumentController {

    private final DocumentRepository documentRepository;
    private final NotebookRepository notebookRepository;

    public DocumentController(DocumentRepository documentRepository, NotebookRepository notebookRepository) {
        this.documentRepository = documentRepository;
        this.notebookRepository = notebookRepository;
    }

    // 接口 1：往笔记本里添加一份新文档 (POST 请求)
    @PostMapping
    
    // 改成：先查 Notebook，再关联
    public Result<Document> createDocument(@Valid @RequestBody Document document, @RequestParam Long notebookId) {
        Notebook notebook = notebookRepository.findById(notebookId).orElseThrow(() -> new RuntimeException("笔记本不存在！"));
        document.setNotebook(notebook);
        notebook.getDocuments().add(document); // 同步双向关联
        document.setCreateTime(LocalDateTime.now());
    return Result.success(documentRepository.save(document));
}
    // 接口 2：查看某个特定笔记本下的所有文档 (GET 请求)
    // 路径会变成类似 /api/documents/notebook/1 (查询 ID 为 1 的笔记本下的文档)
    @GetMapping("/notebook/{notebookId}")
    public Result<List<Document>> getDocumentsByNotebook(@PathVariable Long notebookId) {
        // 调用我们刚才在 Repository 里写的魔法方法！
        return Result.success(documentRepository.findByNotebook_Id(notebookId));
    }
    // 接口 3：上传文件并自动提取文字 (POST 请求)
    @PostMapping("/upload")
    public Result<Document> uploadDocumentFile(
            @RequestParam("notebookId") Long notebookId, // 接收活页夹 ID
            @RequestParam("file") MultipartFile file     // 接收上传的文件
    ) {
        try {
            // 1. 获取文件的真实名字（比如：我的日记.txt）
            String fileName = file.getOriginalFilename();

            // 2. 🌟 核心魔法：把文件里的内容，按照 UTF-8 编码读取成一段超长的 Java 字符串
            String extractedText = new String(file.getBytes(), StandardCharsets.UTF_8);

            // 3. 把提取出来的文字，像之前一样存入数据库
            Document document = new Document();
            // 第 58 行后面加上：
            Notebook notebook = notebookRepository.findById(notebookId).orElseThrow(() -> new RuntimeException("笔记本不存在！"));
            //document.setNotebookId(notebookId);
            // 把注释掉的 setNotebookId 改成：
            document.setNotebook(notebook);
            notebook.getDocuments().add(document); // 同步双向关联
            document.setTitle(fileName);
            document.setContent(extractedText); // 把提取出来的几万字塞进去
            document.setCreateTime(LocalDateTime.now());

            return Result.success(documentRepository.save(document));

        } catch (IOException e) {
            // 如果读取文件失败，程序不能崩溃，要抛出异常报错
            throw new RuntimeException("文件读取失败了！" + e.getMessage());
        }
    }
    // 接口 4：撕毁某一张特定的资料纸 (DELETE 请求)
    // 路径例如：/api/documents/1 (代表删除 ID 为 1 的文档)
    @DeleteMapping("/{id}")
    public Result<Void> deleteDocument(@PathVariable Long id) {
        documentRepository.deleteById(id);
        return Result.success(null);
    }
}
