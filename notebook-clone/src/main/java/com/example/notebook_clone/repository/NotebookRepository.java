package com.example.notebook_clone.repository;
//这是一个 Repository（仓库/数据访问层），你可以把它理解为一个 "数据库管家"
// ——所有对 notebook 表的增删改查操作都通过它来完成。
import java.util.List;
import java.util.Optional;
import com.example.notebook_clone.entity.Notebook;
import org.springframework.data.jpa.repository.JpaRepository;

// 这是一个接口 (interface)，不是类 (class)
// 只要继承了 JpaRepository，Spring 就会自动帮你生成增删改查的所有底层代码！
// <Notebook, Long> 的意思是：这个管家负责管理 Notebook 实体，它的主键类型是 Long。
public interface NotebookRepository extends JpaRepository<Notebook, Long> {
    List<Notebook> findByUserId(Long userId);
    Optional<Notebook> findByIdAndUserId(Long id, Long userId);
    Boolean existsByIdAndUserId(Long id, Long userId);
}
// 接口里面是空的，一行代码都没写。但它已经拥有了以下所有方法：
// notebookRepository.save(notebook);           // 新增或更新一条笔记
// notebookRepository.findById(1L);             // 按 id 查找一条笔记
// notebookRepository.findAll();                // 查出所有笔记
// notebookRepository.deleteById(1L);           // 按 id 删除一条笔记
// notebookRepository.count();                  // 统计总共有多少条笔记
// notebookRepository.existsById(1L);           // 判断某个 id 的笔记是否存在
// ... 
//不需要写任何实现代码，Spring 在项目启动时会自动扫描到这个接口，并在底层用动态代理自动生成所有实现。
