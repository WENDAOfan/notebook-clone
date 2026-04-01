package com.example.notebook_clone.repository;

import com.example.notebook_clone.entity.Document;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface DocumentRepository extends JpaRepository<Document, Long> {
    
    // 🌟 魔法方法：只要你的方法名是以 findBy 开头，后面跟上字段名
    // Spring 就会自动帮你写出类似 `SELECT * FROM document WHERE notebook_id = ?` 的 SQL！
    // List<Document> findByNotebookId(Long notebookId);
    // 第 11 行，改成：
    List<Document> findByNotebook_Id(Long notebookId);

}